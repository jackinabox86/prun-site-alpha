import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import type { HistoricalPriceData, Exchange } from "../../../../src/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const GCS_BUCKET = "https://storage.googleapis.com/prun-site-alpha-bucket/historical-prices";

const EXCHANGE_CODE_TO_NAME: Record<string, Exchange> = {
  ai1: "ANT",
  ci1: "CIS",
  ic1: "ICA",
  nc1: "NCC",
};

interface ManifestEntry {
  ticker: string;
  exchange: string;
  filename: string;
}

interface Manifest {
  generated: string;
  files: ManifestEntry[];
  tickerCount: number;
  fileCount: number;
}

interface LeaderboardEntry {
  ticker: string;
  tradingVolume: number;
}

interface ExchangeLeaderboard {
  exchange: string;
  leaderboard: LeaderboardEntry[];
}

/**
 * Ticker Leaderboard: returns top tickers by trading volume per exchange.
 *
 * Volume already represents total currency value traded (price x quantity)
 * per day, so trading volume is the sum of Volume over the period.
 *
 * Query params:
 *   - days: number of days to look back (default: 30)
 *   - limit: number of top tickers to return per exchange (default: 20)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    if (isNaN(days) || days <= 0) {
      return NextResponse.json(
        { error: "Invalid days parameter" },
        { status: 400 }
      );
    }

    if (isNaN(limit) || limit <= 0) {
      return NextResponse.json(
        { error: "Invalid limit parameter" },
        { status: 400 }
      );
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffMs = cutoffDate.getTime();

    // Load manifest (GCS first, local fallback)
    let manifest: Manifest | null = null;

    try {
      const manifestUrl = `${GCS_BUCKET}/manifest.json`;
      const manifestResponse = await fetch(manifestUrl, {
        cache: "no-store",
        next: { revalidate: 0 },
      });

      if (manifestResponse.ok) {
        manifest = await manifestResponse.json();
        console.log("Leaderboard: loaded manifest from GCS");
      }
    } catch (error) {
      console.warn("Leaderboard: could not load manifest from GCS, trying local file");
    }

    if (!manifest) {
      try {
        const localManifestPath = join(process.cwd(), "public/data/historical-prices-manifest.json");
        const localManifest = readFileSync(localManifestPath, "utf8");
        manifest = JSON.parse(localManifest);
        console.log("Leaderboard: loaded manifest from local file");
      } catch (error) {
        console.error("Leaderboard: could not load local manifest");
      }
    }

    if (!manifest || !manifest.files) {
      return NextResponse.json(
        {
          error: "Manifest file not found",
          hint: "Run: npm run generate-manifest to create the manifest file",
        },
        { status: 503 }
      );
    }

    const exchanges: Exchange[] = ["ANT", "CIS", "ICA", "NCC"];

    // Map: exchange -> Map<ticker, tradingVolume>
    const exchangeTickerVolumes = new Map<string, Map<string, number>>();
    for (const exchange of exchanges) {
      exchangeTickerVolumes.set(exchange, new Map());
    }

    let filesProcessed = 0;

    // Process files in batches
    const BATCH_SIZE = 50;
    const files = manifest.files;

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (entry) => {
        try {
          const fileUrl = `${GCS_BUCKET}/${entry.filename}`;
          const response = await fetch(fileUrl, {
            cache: "no-store",
            next: { revalidate: 0 },
          });

          if (!response.ok) {
            return null;
          }

          const data: HistoricalPriceData = await response.json();

          // Filter data by cutoff date
          const recentData = data.data.filter((d) => d.DateEpochMs >= cutoffMs);

          if (recentData.length === 0) {
            return null;
          }

          // Volume already represents total currency value traded (price x quantity),
          // so trading volume is simply the sum of Volume across the period.
          const tradingVolume = recentData.reduce(
            (sum, d) => sum + d.Volume,
            0
          );

          const exchangeName = EXCHANGE_CODE_TO_NAME[data.exchange] || data.exchange;

          return {
            exchange: exchangeName,
            ticker: data.ticker,
            tradingVolume,
          };
        } catch (error) {
          console.error(`Leaderboard: error processing ${entry.filename}:`, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        if (!result) continue;

        filesProcessed++;

        const tickerMap = exchangeTickerVolumes.get(result.exchange);
        if (tickerMap) {
          const existing = tickerMap.get(result.ticker) || 0;
          tickerMap.set(result.ticker, existing + result.tradingVolume);
        }
      }

      console.log(
        `Leaderboard: processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)}`
      );
    }

    // Build leaderboards per exchange
    const exchangeLeaderboards: ExchangeLeaderboard[] = exchanges.map((exchange) => {
      const tickerMap = exchangeTickerVolumes.get(exchange)!;
      const sorted = Array.from(tickerMap.entries())
        .map(([ticker, tradingVolume]) => ({ ticker, tradingVolume }))
        .sort((a, b) => b.tradingVolume - a.tradingVolume)
        .slice(0, limit);

      return {
        exchange,
        leaderboard: sorted,
      };
    });

    console.log(`Leaderboard: complete, ${filesProcessed} files processed`);

    return NextResponse.json({
      days,
      limit,
      cutoffDate: cutoffDate.toISOString().split("T")[0],
      exchangeLeaderboards,
      filesProcessed,
      lastUpdated: Date.now(),
    });
  } catch (error) {
    console.error("Error in leaderboard API:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

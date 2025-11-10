import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import type { HistoricalPriceData, Exchange } from "../../../src/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const GCS_BUCKET = "https://storage.googleapis.com/prun-site-alpha-bucket/historical-prices";

// Mapping from FNAR exchange codes to human-readable names
const EXCHANGE_CODE_TO_NAME: Record<string, Exchange> = {
  ai1: "ANT",
  ci1: "CIS",
  ic1: "ICA",
  nc1: "NCC",
};

interface ExchangeStats {
  exchange: string;
  avgTradedCount: number;
  recordCount: number;
  avgPrice: number;
  totalVolume: number;
  totalTraded: number;
}

interface AnalysisResult {
  days: number;
  cutoffDate: string;
  exchangeStats: ExchangeStats[];
  universeTotal: {
    avgTradedCount: number;
    recordCount: number;
    avgPrice: number;
    totalVolume: number;
    totalTraded: number;
  };
  tickerCount: number;
  filesProcessed: number;
  lastUpdated: number;
}

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

/**
 * Fetch all ticker files from GCS and analyze trading data
 *
 * Query params:
 *   - days: number of days to look back (default: 90)
 *   - ticker: specific ticker to analyze (optional, if not provided analyzes all)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "90", 10);
    const ticker = searchParams.get("ticker")?.toUpperCase() || null;

    if (isNaN(days) || days <= 0) {
      return NextResponse.json(
        { error: "Invalid days parameter" },
        { status: 400 }
      );
    }

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffMs = cutoffDate.getTime();

    // Try to load manifest from GCS, fall back to local file
    let manifest: Manifest | null = null;

    try {
      // Try GCS first
      const manifestUrl = `${GCS_BUCKET}/manifest.json`;
      const manifestResponse = await fetch(manifestUrl, {
        cache: "no-store",
        next: { revalidate: 0 }
      });

      if (manifestResponse.ok) {
        manifest = await manifestResponse.json();
        console.log("Loaded manifest from GCS");
      }
    } catch (error) {
      console.warn("Could not load manifest from GCS, trying local file");
    }

    // Fall back to local file
    if (!manifest) {
      try {
        const localManifestPath = join(process.cwd(), "public/data/historical-prices-manifest.json");
        const localManifest = readFileSync(localManifestPath, "utf8");
        manifest = JSON.parse(localManifest);
        console.log("Loaded manifest from local file");
      } catch (error) {
        console.error("Could not load local manifest");
      }
    }

    if (!manifest || !manifest.files) {
      return NextResponse.json(
        {
          error: "Manifest file not found",
          hint: "Run: npm run generate-manifest to create the manifest file"
        },
        { status: 503 }
      );
    }

    // Filter files by ticker if specified
    let filesToProcess = manifest.files;
    if (ticker) {
      filesToProcess = manifest.files.filter(f => f.ticker === ticker);
      if (filesToProcess.length === 0) {
        return NextResponse.json(
          {
            error: `No data found for ticker "${ticker}"`,
            hint: "Check that the ticker exists in the system"
          },
          { status: 404 }
        );
      }
      console.log(`Processing ${filesToProcess.length} files for ticker ${ticker} with ${days} day lookback...`);
    } else {
      console.log(`Processing ${filesToProcess.length} files with ${days} day lookback...`);
    }

    const exchanges: Exchange[] = ["ANT", "CIS", "ICA", "NCC"];
    const exchangeMap: Map<string, {
      totalVolume: number;
      totalTraded: number;
      recordCount: number;
    }> = new Map();

    let totalVolumeUniverse = 0;
    let totalTradedUniverse = 0;
    let totalRecordsUniverse = 0;
    const processedTickers = new Set<string>();
    let filesProcessed = 0;

    // Initialize exchange maps
    for (const exchange of exchanges) {
      exchangeMap.set(exchange, {
        totalVolume: 0,
        totalTraded: 0,
        recordCount: 0,
      });
    }

    // Process files in batches to avoid overwhelming the system
    const BATCH_SIZE = 50;
    const files = filesToProcess;

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (entry) => {
        try {
          const fileUrl = `${GCS_BUCKET}/${entry.filename}`;
          const response = await fetch(fileUrl, {
            cache: "no-store",
            next: { revalidate: 0 }
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

          // Calculate metrics
          const totalVolume = recentData.reduce((sum, d) => sum + d.Volume, 0);
          const totalTraded = recentData.reduce((sum, d) => sum + d.Traded, 0);

          // Convert FNAR exchange code to human-readable name
          const exchangeName = EXCHANGE_CODE_TO_NAME[data.exchange] || data.exchange;

          return {
            exchange: exchangeName,
            ticker: data.ticker,
            totalVolume,
            totalTraded,
            recordCount: recentData.length,
          };
        } catch (error) {
          console.error(`Error processing ${entry.filename}:`, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);

      // Aggregate results
      for (const result of batchResults) {
        if (!result) continue;

        filesProcessed++;
        processedTickers.add(result.ticker);

        const exchangeStats = exchangeMap.get(result.exchange);
        if (exchangeStats) {
          exchangeStats.totalVolume += result.totalVolume;
          exchangeStats.totalTraded += result.totalTraded;
          exchangeStats.recordCount += result.recordCount;
        }

        totalVolumeUniverse += result.totalVolume;
        totalTradedUniverse += result.totalTraded;
        totalRecordsUniverse += result.recordCount;
      }

      // Log progress
      console.log(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)}`);
    }

    // Build exchange stats array
    const exchangeStats: ExchangeStats[] = [];
    for (const [exchange, stats] of exchangeMap.entries()) {
      exchangeStats.push({
        exchange,
        avgTradedCount: stats.recordCount > 0
          ? stats.totalTraded / stats.recordCount
          : 0,
        recordCount: stats.recordCount,
        avgPrice: stats.totalTraded > 0
          ? stats.totalVolume / stats.totalTraded
          : 0,
        totalVolume: stats.totalVolume,
        totalTraded: stats.totalTraded,
      });
    }

    const result: any = {
      days,
      cutoffDate: cutoffDate.toISOString().split('T')[0],
      exchangeStats,
      universeTotal: {
        avgTradedCount: totalRecordsUniverse > 0
          ? totalTradedUniverse / totalRecordsUniverse
          : 0,
        recordCount: totalRecordsUniverse,
        avgPrice: totalTradedUniverse > 0
          ? totalVolumeUniverse / totalTradedUniverse
          : 0,
        totalVolume: totalVolumeUniverse,
        totalTraded: totalTradedUniverse,
      },
      tickerCount: processedTickers.size,
      filesProcessed,
      lastUpdated: Date.now(),
    };

    // Include ticker in response if analyzing a specific ticker
    if (ticker) {
      result.ticker = ticker;
    }

    console.log(`Analysis complete: ${filesProcessed} files, ${processedTickers.size} tickers`);

    return NextResponse.json(result);

  } catch (error) {
    console.error("Error in historical analysis API:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

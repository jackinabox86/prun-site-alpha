// app/api/best-recipes/history/route.ts
import { NextResponse } from "next/server";
import type { Exchange, PriceType } from "@/types";
import type { BestRecipeResult } from "@/server/bestRecipes";
import { apiCache } from "../lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const GCS_BUCKET = "https://storage.googleapis.com/prun-site-alpha-bucket";
const VALID_EXCHANGES: Exchange[] = ["ANT", "CIS", "ICA", "NCC", "UNV"];
const VALID_EXCHANGE_DISPLAYS = ["ANT", "CIS", "ICA", "NCC", "UNV7", "UNV30"];
const VALID_SELL_AT = ["bid", "ask", "pp7", "pp30"];

interface HistoricalSnapshot {
  timestamp: string;
  recipeId: string | null;
  scenario: string;
  profitPA: number;
  buyAllProfitPA: number | null;
  building?: string | null;
  changeFromPrevious?: number;
  percentChange?: number;
}

interface IndexEntry {
  timestamp: string;
  generatedAt: string;
  tickerCount: number;
  durationSeconds: number;
}

interface IndexFile {
  snapshots: IndexEntry[];
  exchange: string;
  sellAt: string;
  lastUpdated: string;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get("ticker");
    const exchangeParam = searchParams.get("exchange")?.toUpperCase() || "ANT";
    const sellAtParam = searchParams.get("sellAt")?.toLowerCase() || "bid";
    const limitParam = searchParams.get("limit") || "100";
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    // Validate ticker is provided
    if (!ticker) {
      return NextResponse.json(
        { success: false, error: "Missing required parameter: ticker" },
        { status: 400 }
      );
    }

    // Validate exchange parameter
    const exchange = VALID_EXCHANGE_DISPLAYS.includes(exchangeParam)
      ? exchangeParam
      : "ANT";

    // Validate sellAt parameter
    const sellAt = VALID_SELL_AT.includes(sellAtParam) ? sellAtParam : "bid";

    const limit = Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 1000);

    // Create cache key
    const cacheKey = `history:${ticker}:${exchange}:${sellAt}:${limit}:${fromParam || ''}:${toParam || ''}`;

    // Check cache (5 min TTL)
    const cached = apiCache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Construct the config name (e.g., "best-recipes-ANT-bid")
    const configName = `best-recipes-${exchange}-${sellAt}`;

    // Fetch the index file to get list of available snapshots
    const indexUrl = `${GCS_BUCKET}/historical/${configName}/index.json`;
    console.log(`Fetching index from ${indexUrl}...`);

    let indexData: IndexFile;
    try {
      const indexResponse = await fetch(indexUrl, { cache: "no-store" });
      if (!indexResponse.ok) {
        throw new Error(`Index not found: ${indexResponse.status}`);
      }
      indexData = await indexResponse.json();
    } catch (err: any) {
      console.error(`Error fetching index: ${err.message}`);
      return NextResponse.json(
        {
          success: false,
          error: `No historical data available for ${exchange}-${sellAt}. The system may not have generated snapshots yet.`,
        },
        { status: 404 }
      );
    }

    // Filter snapshots by date range if provided
    let snapshots = indexData.snapshots;
    if (fromParam) {
      const fromDate = new Date(fromParam);
      snapshots = snapshots.filter(s => new Date(s.timestamp) >= fromDate);
    }
    if (toParam) {
      const toDate = new Date(toParam);
      snapshots = snapshots.filter(s => new Date(s.timestamp) <= toDate);
    }

    // Sort by timestamp descending (most recent first) and apply limit
    snapshots = snapshots.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ).slice(0, limit);

    // Fetch all snapshots in parallel
    const snapshotPromises = snapshots.map(async (snapshot) => {
      const snapshotUrl = `${GCS_BUCKET}/historical/${configName}/${snapshot.timestamp}.json`;

      try {
        const snapshotResponse = await fetch(snapshotUrl, { cache: "no-store" });
        if (!snapshotResponse.ok) {
          console.warn(`Failed to fetch snapshot ${snapshot.timestamp}: ${snapshotResponse.status}`);
          return null;
        }

        const snapshotData: BestRecipeResult[] = await snapshotResponse.json();
        const tickerData = snapshotData.find(item => item.ticker === ticker);

        if (!tickerData) return null;

        return {
          timestamp: snapshot.timestamp,
          recipeId: tickerData.recipeId,
          scenario: tickerData.scenario,
          profitPA: tickerData.profitPA,
          buyAllProfitPA: tickerData.buyAllProfitPA,
          building: tickerData.building,
        };
      } catch (err: any) {
        console.warn(`Error processing snapshot ${snapshot.timestamp}:`, err.message);
        return null;
      }
    });

    // Fetch all in parallel
    const results = await Promise.all(snapshotPromises);

    // Filter out nulls and sort by timestamp ascending
    const validSnapshots = results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Calculate changes sequentially after data is loaded
    const history: HistoricalSnapshot[] = [];
    let previousProfitPA: number | null = null;

    for (const snapshot of validSnapshots) {
      const currentProfitPA = snapshot.profitPA;
      const changeFromPrevious = previousProfitPA !== null
        ? currentProfitPA - previousProfitPA
        : undefined;
      const percentChange = previousProfitPA !== null && previousProfitPA !== 0
        ? ((currentProfitPA - previousProfitPA) / Math.abs(previousProfitPA)) * 100
        : undefined;

      history.push({
        ...snapshot,
        changeFromPrevious,
        percentChange,
      });

      previousProfitPA = currentProfitPA;
    }

    if (history.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `No historical data found for ticker "${ticker}" in ${exchange}-${sellAt}`,
        },
        { status: 404 }
      );
    }

    const response = {
      success: true,
      ticker,
      exchange,
      sellAt,
      history,
      count: history.length,
    };

    // Cache result for 5 minutes
    apiCache.set(cacheKey, response, 5 * 60 * 1000);

    return NextResponse.json(response);
  } catch (err: any) {
    console.error("Error in best-recipes/history API:", err);
    return NextResponse.json(
      {
        success: false,
        error: String(err?.message ?? err),
        stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
      },
      { status: 500 }
    );
  }
}

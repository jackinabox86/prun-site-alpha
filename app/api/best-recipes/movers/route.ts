// app/api/best-recipes/movers/route.ts
import { NextResponse } from "next/server";
import type { Exchange } from "@/types";
import type { BestRecipeResult } from "@/server/bestRecipes";
import { apiCache } from "../lib/cache";
import { parseTimestamp, getTimestampMillis } from "../lib/timestamp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const GCS_BUCKET = "https://storage.googleapis.com/prun-site-alpha-bucket";
const VALID_EXCHANGE_DISPLAYS = ["ANT", "CIS", "ICA", "NCC", "UNV7", "UNV30"];
const VALID_SELL_AT = ["bid", "ask", "pp7", "pp30"];
const VALID_PERIODS = ["1d", "7d", "30d"];

interface MoverResult {
  ticker: string;
  currentProfitPA: number;
  previousProfitPA: number | null;
  absoluteChange: number;
  percentChange: number;
  recipeChanged: boolean;
  currentRecipeId: string | null;
  previousRecipeId: string | null;
  currentBuilding?: string | null;
  previousBuilding?: string | null;
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

function getTargetTimestamp(period: string, currentTimestamp: Date): Date {
  const target = new Date(currentTimestamp);

  switch (period) {
    case "1d":
      target.setDate(target.getDate() - 1);
      break;
    case "7d":
      target.setDate(target.getDate() - 7);
      break;
    case "30d":
      target.setDate(target.getDate() - 30);
      break;
  }

  return target;
}

function findClosestSnapshot(snapshots: IndexEntry[], targetDate: Date): IndexEntry | null {
  if (snapshots.length === 0) return null;

  // Find the snapshot closest to (but not after) the target date
  const targetMillis = targetDate.getTime();
  const beforeOrAt = snapshots
    .filter(s => getTimestampMillis(s.timestamp) <= targetMillis)
    .sort((a, b) => getTimestampMillis(b.timestamp) - getTimestampMillis(a.timestamp));

  return beforeOrAt[0] || null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "1d";
    const exchangeParam = searchParams.get("exchange")?.toUpperCase() || "ANT";
    const sellAtParam = searchParams.get("sellAt")?.toLowerCase() || "bid";
    const limitParam = searchParams.get("limit") || "50";
    const sortBy = searchParams.get("sortBy") || "percentage";

    // Validate period
    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid period "${period}". Valid periods: ${VALID_PERIODS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate exchange parameter
    const exchange = VALID_EXCHANGE_DISPLAYS.includes(exchangeParam)
      ? exchangeParam
      : "ANT";

    // Validate sellAt parameter
    const sellAt = VALID_SELL_AT.includes(sellAtParam) ? sellAtParam : "bid";

    const limit = Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 500);

    // Create cache key
    const cacheKey = `movers:${period}:${exchange}:${sellAt}:${limit}:${sortBy}`;

    // Check cache (5 min TTL)
    const cached = apiCache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Construct the config name
    const configName = `best-recipes-${exchange}-${sellAt}`;

    // Fetch the index file
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

    if (indexData.snapshots.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No snapshots available yet",
        },
        { status: 404 }
      );
    }

    // Find the most recent snapshot
    const sortedSnapshots = [...indexData.snapshots].sort(
      (a, b) => getTimestampMillis(b.timestamp) - getTimestampMillis(a.timestamp)
    );
    const currentSnapshot = sortedSnapshots[0];
    const currentTimestamp = parseTimestamp(currentSnapshot.timestamp);

    // Find the target timestamp based on period
    const targetTimestamp = getTargetTimestamp(period, currentTimestamp);

    // Find the closest snapshot to the target timestamp
    const previousSnapshot = findClosestSnapshot(sortedSnapshots, targetTimestamp);

    if (!previousSnapshot) {
      return NextResponse.json(
        {
          success: false,
          error: `Not enough historical data for ${period} comparison. Oldest snapshot: ${sortedSnapshots[sortedSnapshots.length - 1].timestamp}`,
        },
        { status: 404 }
      );
    }

    // Fetch both snapshots
    const currentUrl = `${GCS_BUCKET}/historical/${configName}/${currentSnapshot.timestamp}.json`;
    const previousUrl = `${GCS_BUCKET}/historical/${configName}/${previousSnapshot.timestamp}.json`;

    console.log(`Comparing ${currentSnapshot.timestamp} with ${previousSnapshot.timestamp}`);

    const [currentResponse, previousResponse] = await Promise.all([
      fetch(currentUrl, { cache: "no-store" }),
      fetch(previousUrl, { cache: "no-store" }),
    ]);

    if (!currentResponse.ok || !previousResponse.ok) {
      throw new Error("Failed to fetch snapshot data");
    }

    const currentData: BestRecipeResult[] = await currentResponse.json();
    const previousData: BestRecipeResult[] = await previousResponse.json();

    // Create maps for easy lookup
    const previousMap = new Map(previousData.map(item => [item.ticker, item]));

    // Calculate movers
    const movers: MoverResult[] = [];

    for (const currentItem of currentData) {
      const previousItem = previousMap.get(currentItem.ticker);

      if (previousItem) {
        const absoluteChange = currentItem.profitPA - previousItem.profitPA;
        const percentChange = previousItem.profitPA !== 0
          ? (absoluteChange / Math.abs(previousItem.profitPA)) * 100
          : 0;

        movers.push({
          ticker: currentItem.ticker,
          currentProfitPA: currentItem.profitPA,
          previousProfitPA: previousItem.profitPA,
          absoluteChange,
          percentChange,
          recipeChanged: currentItem.recipeId !== previousItem.recipeId,
          currentRecipeId: currentItem.recipeId,
          previousRecipeId: previousItem.recipeId,
          currentBuilding: currentItem.building,
          previousBuilding: previousItem.building,
        });
      } else {
        // New ticker - not in previous snapshot
        movers.push({
          ticker: currentItem.ticker,
          currentProfitPA: currentItem.profitPA,
          previousProfitPA: null,
          absoluteChange: currentItem.profitPA,
          percentChange: 100, // Treat as 100% increase for new tickers
          recipeChanged: false,
          currentRecipeId: currentItem.recipeId,
          previousRecipeId: null,
          currentBuilding: currentItem.building,
          previousBuilding: null,
        });
      }
    }

    // Sort movers by percentage change (default) or absolute change
    movers.sort((a, b) => {
      if (sortBy === "absolute") {
        return Math.abs(b.absoluteChange) - Math.abs(a.absoluteChange);
      }
      return Math.abs(b.percentChange) - Math.abs(a.percentChange);
    });

    // Apply limit
    const topMovers = movers.slice(0, limit);

    const response = {
      success: true,
      period,
      exchange,
      sellAt,
      comparisonTimestamps: {
        current: currentSnapshot.timestamp,
        previous: previousSnapshot.timestamp,
      },
      movers: topMovers,
      count: topMovers.length,
      totalTickersCompared: movers.length,
    };

    // Cache result for 5 minutes
    apiCache.set(cacheKey, response, 5 * 60 * 1000);

    return NextResponse.json(response);
  } catch (err: any) {
    console.error("Error in best-recipes/movers API:", err);
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

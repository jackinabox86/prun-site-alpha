// app/api/inflation/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { execSync } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GCS_BUCKET = "https://storage.googleapis.com/prun-site-alpha-bucket";

// Exchange code mapping
const EXCHANGE_MAP: Record<string, string> = {
  ANT: "ai1",
  CIS: "ci1",
  ICA: "ic1",
  NCC: "nc1",
};

/**
 * Detect current git branch with multiple fallback methods
 */
function getCurrentBranch(): string {
  try {
    // Method 1: git rev-parse (local development)
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (branch && branch !== "HEAD") return branch;
  } catch {}

  try {
    // Method 2: GITHUB_REF environment variable (GitHub Actions/deployments)
    if (process.env.GITHUB_REF) {
      const match = process.env.GITHUB_REF.match(/refs\/heads\/(.+)/);
      if (match && match[1]) return match[1];
    }
  } catch {}

  try {
    // Method 3: Read .git/HEAD directly
    const gitHead = readFileSync(".git/HEAD", "utf8").trim();
    const match = gitHead.match(/ref: refs\/heads\/(.+)/);
    if (match && match[1]) return match[1];
  } catch {}

  // Fallback
  return "unknown";
}

/**
 * Check if branch is production
 */
function isProductionBranch(branch: string): boolean {
  return branch === "main";
}

/**
 * Get GCS path for VWAP data based on current branch
 */
function getVWAPPath(): string {
  const currentBranch = getCurrentBranch();
  const isProduction = isProductionBranch(currentBranch);

  if (isProduction) {
    return "historical-prices-vwap";
  } else {
    return `historical-prices-vwap-test/${currentBranch}`;
  }
}

interface VWAPDataPoint {
  DateEpochMs: number;
  rawVolume: number;
  rawTraded: number;
  rawOpen: number;
  rawClose: number;
  rawHigh: number;
  rawLow: number;
  dailyVWAP: number | null;
  rollingMedian30d: number | null;
  rollingQ1_30d: number | null;
  rollingQ3_30d: number | null;
  rollingIQR_30d: number | null;
  lowerFloor: number | null;
  upperCap: number | null;
  clippedDailyVWAP: number | null;
  vwap7d: number | null;
  tradingDaysInWindow: number;
  wasForwardFilled: boolean;
}

interface VWAPHistoricalData {
  ticker: string;
  exchange: string;
  calculationVersion: string;
  lastCalculated: number;
  data: VWAPDataPoint[];
}

interface TickerWeight {
  ticker: string;
  weight: number;
  indexDateVolume: number;
}

interface IndexDataPoint {
  date: string;
  timestamp: number;
  indexValue: number;
  contributions: Record<string, number>;
}

/**
 * Fetch VWAP data from GCS for a specific ticker and exchange
 */
async function fetchVWAPData(ticker: string, exchange: string): Promise<VWAPHistoricalData | null> {
  try {
    const vwapPath = getVWAPPath();
    const shortExchange = EXCHANGE_MAP[exchange] || exchange.toLowerCase();
    const filename = `${ticker}-${shortExchange}-vwap.json`;
    const url = `${GCS_BUCKET}/${vwapPath}/${filename}`;

    console.log(`Fetching VWAP data: ${url}`);
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      console.warn(`Failed to fetch VWAP data for ${ticker}.${exchange}: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching VWAP data for ${ticker}.${exchange}:`, error);
    return null;
  }
}

/**
 * Calculate inflation index from VWAP data
 */
function calculateIndex(
  vwapDataMap: Map<string, VWAPHistoricalData>,
  indexTimestamp: number,
  weightType: "equal" | "volume"
): { indexData: IndexDataPoint[]; weights: TickerWeight[] } {
  // Step 1: Calculate weights
  const weights: TickerWeight[] = [];
  const tickers = Array.from(vwapDataMap.keys());

  if (weightType === "equal") {
    // Equal weight: 1/N for each ticker
    const equalWeight = 1 / tickers.length;
    for (const ticker of tickers) {
      weights.push({ ticker, weight: equalWeight, indexDateVolume: 0 });
    }
  } else {
    // Volume-weighted: based on rawVolume on index date
    const volumes: Record<string, number> = {};
    let totalVolume = 0;

    for (const [ticker, data] of vwapDataMap.entries()) {
      const indexPoint = data.data.find(d => d.DateEpochMs === indexTimestamp);
      if (indexPoint && indexPoint.rawVolume > 0) {
        volumes[ticker] = indexPoint.rawVolume;
        totalVolume += indexPoint.rawVolume;
      } else {
        volumes[ticker] = 0;
      }
    }

    if (totalVolume === 0) {
      // Fallback to equal weight if no volume data
      const equalWeight = 1 / tickers.length;
      for (const ticker of tickers) {
        weights.push({ ticker, weight: equalWeight, indexDateVolume: 0 });
      }
    } else {
      for (const ticker of tickers) {
        weights.push({
          ticker,
          weight: volumes[ticker] / totalVolume,
          indexDateVolume: volumes[ticker],
        });
      }
    }
  }

  // Step 2: Get base prices on index date
  const basePrices: Record<string, number> = {};
  for (const [ticker, data] of vwapDataMap.entries()) {
    const indexPoint = data.data.find(d => d.DateEpochMs === indexTimestamp);
    if (indexPoint && indexPoint.vwap7d !== null) {
      basePrices[ticker] = indexPoint.vwap7d;
    }
  }

  // Step 3: Build complete date list (union of all dates)
  const allDates = new Set<number>();
  for (const data of vwapDataMap.values()) {
    for (const point of data.data) {
      allDates.add(point.DateEpochMs);
    }
  }
  const sortedDates = Array.from(allDates).sort((a, b) => a - b);

  // Step 4: Calculate index for each date
  const indexData: IndexDataPoint[] = [];
  for (const timestamp of sortedDates) {
    let indexValue = 0;
    const contributions: Record<string, number> = {};

    for (const { ticker, weight } of weights) {
      const data = vwapDataMap.get(ticker);
      if (!data) continue;

      const point = data.data.find(d => d.DateEpochMs === timestamp);
      if (point && point.vwap7d !== null && basePrices[ticker]) {
        // Calculate price ratio and contribution to index
        const priceRatio = point.vwap7d / basePrices[ticker];
        const contribution = weight * priceRatio * 100;
        contributions[ticker] = contribution;
        indexValue += contribution;
      }
    }

    // Only include dates where we have at least some data
    if (Object.keys(contributions).length > 0) {
      const date = new Date(timestamp);
      indexData.push({
        date: date.toISOString().split("T")[0],
        timestamp,
        indexValue,
        contributions,
      });
    }
  }

  return { indexData, weights };
}

/**
 * GET /api/inflation
 * Query params:
 *   - tickers: comma-separated list of tickers (e.g., "RAT,DW,PWO")
 *   - exchange: exchange code (default: "ANT")
 *   - indexDate: ISO date string (e.g., "2024-08-15")
 *   - weightType: "equal" or "volume" (default: "equal")
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const tickersParam = searchParams.get("tickers");
    const exchange = searchParams.get("exchange") || "ANT";
    const indexDateParam = searchParams.get("indexDate");
    const weightType = (searchParams.get("weightType") || "equal") as "equal" | "volume";

    // Validate inputs
    if (!tickersParam) {
      return NextResponse.json(
        { error: "Missing required parameter: tickers" },
        { status: 400 }
      );
    }

    if (!indexDateParam) {
      return NextResponse.json(
        { error: "Missing required parameter: indexDate" },
        { status: 400 }
      );
    }

    const tickers = tickersParam.split(",").map(t => t.trim().toUpperCase()).filter(t => t);
    if (tickers.length === 0) {
      return NextResponse.json(
        { error: "No valid tickers provided" },
        { status: 400 }
      );
    }

    // Parse index date
    const indexDate = new Date(indexDateParam);
    indexDate.setUTCHours(0, 0, 0, 0);
    const indexTimestamp = indexDate.getTime();

    if (isNaN(indexTimestamp)) {
      return NextResponse.json(
        { error: "Invalid index date format" },
        { status: 400 }
      );
    }

    // Fetch VWAP data for all tickers
    const vwapDataMap = new Map<string, VWAPHistoricalData>();
    const fetchPromises = tickers.map(ticker => fetchVWAPData(ticker, exchange));
    const results = await Promise.all(fetchPromises);

    for (let i = 0; i < tickers.length; i++) {
      const data = results[i];
      if (data) {
        vwapDataMap.set(tickers[i], data);
      }
    }

    if (vwapDataMap.size === 0) {
      return NextResponse.json(
        { error: "No VWAP data found for any of the specified tickers" },
        { status: 404 }
      );
    }

    // Calculate index
    const { indexData, weights } = calculateIndex(vwapDataMap, indexTimestamp, weightType);

    return NextResponse.json({
      success: true,
      exchange,
      indexDate: indexDateParam,
      indexTimestamp,
      weightType,
      tickers: Array.from(vwapDataMap.keys()),
      tickersNotFound: tickers.filter(t => !vwapDataMap.has(t)),
      weights,
      dataPoints: indexData.length,
      data: indexData,
    });
  } catch (error: any) {
    console.error("Error calculating inflation index:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

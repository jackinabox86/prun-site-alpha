// app/api/inflation/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GCS_BUCKET = "https://storage.googleapis.com/prun-site-alpha-bucket";
const GCS_VWAP_PATH = "historical-prices-vwap";

// Exchange code mapping
const EXCHANGE_MAP: Record<string, string> = {
  ANT: "ai1",
  CIS: "ci1",
  ICA: "ic1",
  NCC: "nc1",
};

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
  indexDateVolume: number; // For volume weighting: sum of rawVolume over ±7 days from index date
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
    const shortExchange = EXCHANGE_MAP[exchange] || exchange.toLowerCase();
    const filename = `${ticker}-${shortExchange}-vwap.json`;
    const url = `${GCS_BUCKET}/${GCS_VWAP_PATH}/${filename}`;

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
): { indexData: IndexDataPoint[]; weights: TickerWeight[]; tickersWithoutBasePrice: string[] } {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Step 1: Get base prices on the index date. Use the nearest point within a
  // small tolerance rather than requiring an exact timestamp match, so a data
  // gap or timestamp misalignment on the chosen date doesn't drop the ticker.
  const BASE_TOLERANCE_MS = 3 * MS_PER_DAY;
  const basePrices: Record<string, number> = {};
  for (const [ticker, data] of vwapDataMap.entries()) {
    let bestPrice: number | null = null;
    let bestDist = Infinity;
    for (const point of data.data) {
      if (point.vwap7d === null) continue;
      const dist = Math.abs(point.DateEpochMs - indexTimestamp);
      if (dist <= BASE_TOLERANCE_MS && dist < bestDist) {
        bestDist = dist;
        bestPrice = point.vwap7d;
      }
    }
    if (bestPrice !== null && bestPrice > 0) {
      basePrices[ticker] = bestPrice;
    }
  }

  // Tickers without a base price cannot contribute to the index at all;
  // weights must be computed over the eligible set only, otherwise the index
  // starts below 100 and every value is biased low.
  const tickers = Array.from(vwapDataMap.keys()).filter(t => basePrices[t] !== undefined);
  const tickersWithoutBasePrice = Array.from(vwapDataMap.keys()).filter(t => basePrices[t] === undefined);

  const weights: TickerWeight[] = [];
  if (tickers.length === 0) {
    return { indexData: [], weights, tickersWithoutBasePrice };
  }

  // Step 2: Calculate weights over the eligible tickers
  if (weightType === "equal") {
    // Equal weight: 1/N for each eligible ticker
    const equalWeight = 1 / tickers.length;
    for (const ticker of tickers) {
      weights.push({ ticker, weight: equalWeight, indexDateVolume: 0 });
    }
  } else {
    // Volume-weighted: based on rawVolume from 7 days before the index date to now
    const DAYS_BEFORE = 7;
    const rangeStart = indexTimestamp - (DAYS_BEFORE * MS_PER_DAY);
    const rangeEnd = Date.now();

    const volumes: Record<string, number> = {};
    let totalVolume = 0;

    for (const ticker of tickers) {
      const data = vwapDataMap.get(ticker)!;
      // Sum rawVolume over the date range
      const volumeInRange = data.data
        .filter(d => d.DateEpochMs >= rangeStart && d.DateEpochMs <= rangeEnd)
        .reduce((sum, d) => sum + (d.rawVolume || 0), 0);

      volumes[ticker] = volumeInRange;
      totalVolume += volumeInRange;
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

  // Step 3: Build complete date list (union of all dates)
  const allDates = new Set<number>();
  for (const data of vwapDataMap.values()) {
    for (const point of data.data) {
      allDates.add(point.DateEpochMs);
    }
  }
  const sortedDates = Array.from(allDates).sort((a, b) => a - b);

  // Step 4: Calculate index for each date. Renormalize by the weight actually
  // present that day, so a ticker with a gap on one date doesn't drag the
  // index down artificially.
  const indexData: IndexDataPoint[] = [];
  for (const timestamp of sortedDates) {
    let rawSum = 0;
    let presentWeight = 0;
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
        rawSum += contribution;
        presentWeight += weight;
      }
    }

    // Only include dates where we have at least some data
    if (presentWeight > 0) {
      const scale = 1 / presentWeight;
      for (const ticker of Object.keys(contributions)) {
        contributions[ticker] *= scale;
      }
      const date = new Date(timestamp);
      indexData.push({
        date: date.toISOString().split("T")[0],
        timestamp,
        indexValue: rawSum * scale,
        contributions,
      });
    }
  }

  return { indexData, weights, tickersWithoutBasePrice };
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

    // Each ticker costs one outbound GCS fetch — bound the fan-out
    const MAX_TICKERS = 50;
    if (tickers.length > MAX_TICKERS) {
      return NextResponse.json(
        { error: `Too many tickers: ${tickers.length}. Maximum is ${MAX_TICKERS}.` },
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
    const { indexData, weights, tickersWithoutBasePrice } = calculateIndex(vwapDataMap, indexTimestamp, weightType);

    if (weights.length === 0) {
      return NextResponse.json(
        { error: "No ticker has price data near the chosen index date. Pick a different index date." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      exchange,
      indexDate: indexDateParam,
      indexTimestamp,
      weightType,
      tickers: weights.map(w => w.ticker),
      tickersNotFound: tickers.filter(t => !vwapDataMap.has(t)),
      tickersWithoutBasePrice,
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


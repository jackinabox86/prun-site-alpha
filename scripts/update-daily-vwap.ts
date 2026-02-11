import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";

/**
 * Daily Incremental VWAP Update Script
 *
 * Updates VWAP data for recent dates without recalculating entire history.
 * Looks at target date = today - 6 days to allow time for data to arrive.
 *
 * Strategy:
 * - Calculate VWAP for dates from (target - 20) to target
 *   - 7 days for reference price calculation
 *   - 7 days for rolling window
 *   - 6 days buffer
 * - Merge with existing VWAP file (keep old dates, update recent)
 * - Much faster than full recalculation
 *
 * Usage:
 *   npm run update-daily-vwap
 *   npm run update-daily-vwap -- --dry-run
 */

interface RawDataPoint {
  DateEpochMs: number;
  Open: number;
  Close: number;
  High: number;
  Low: number;
  Volume: number;
  Traded: number;
}

interface RawHistoricalData {
  ticker: string;
  exchange: string;
  lastUpdated: number;
  data: RawDataPoint[];
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
  referencePrice: number | null;
  lowerFloor: number | null;
  upperCap: number | null;
  clippedDailyVWAP: number | null;
  vwap7d: number | null;
  tradingDaysInWindow: number;
  wasForwardFilled: boolean;
  traded7d: number;
  traded30d: number;
  averageTraded7d: number;
  averageTraded30d: number;
}

interface VWAPHistoricalData {
  ticker: string;
  exchange: string;
  calculationVersion: string;
  lastCalculated: number;
  data: VWAPDataPoint[];
  statistics: {
    totalDays: number;
    tradingDays: number;
    clippedDays: number;
    forwardFilledDays: number;
    avgVWAP7d: number | null;
  };
}

// Exchange code mapping
const EXCHANGE_MAP: Record<string, string> = {
  ANT: "ai1",
  CIS: "ci1",
  ICA: "ic1",
  NCC: "nc1",
};

const EXCHANGES = ["ANT", "CIS", "ICA", "NCC"] as const;

// GCS paths
const GCS_BUCKET = "prun-site-alpha-bucket";
const GCS_RAW_PATH = "historical-prices";
const GCS_VWAP_PATH = "historical-prices-vwap";
const LOCAL_TEMP_DIR = "public/data/temp-vwap-update";

// Constants
const LOOKBACK_DAYS = 6; // Look at date 6 days in the past
const CALCULATION_WINDOW = 20; // Recalculate last 20 days (7 reference + 7 rolling + buffer)

/**
 * Load tickers from config file
 */
function loadTickersFromFile(filepath: string): string[] {
  const content = readFileSync(filepath, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Get target date (today - 6 days)
 */
function getTargetDate(): { timestamp: number; isoDate: string } {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const targetDate = new Date(today);
  targetDate.setUTCDate(targetDate.getUTCDate() - LOOKBACK_DAYS);

  return {
    timestamp: targetDate.getTime(),
    isoDate: targetDate.toISOString().split("T")[0],
  };
}

/**
 * Download raw historical data from GCS
 */
function downloadRawDataFromGCS(ticker: string, fnarExchange: string): RawHistoricalData | null {
  const filename = `${ticker}-${fnarExchange}.json`;
  const gcsPath = `gs://${GCS_BUCKET}/${GCS_RAW_PATH}/${filename}`;
  const localPath = `${LOCAL_TEMP_DIR}/raw-${filename}`;

  try {
    execSync(`gsutil cp "${gcsPath}" "${localPath}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const content = readFileSync(localPath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Download existing VWAP data from GCS
 */
function downloadVWAPFromGCS(ticker: string, fnarExchange: string): VWAPHistoricalData | null {
  const filename = `${ticker}-${fnarExchange}-vwap.json`;
  const gcsPath = `gs://${GCS_BUCKET}/${GCS_VWAP_PATH}/${filename}`;
  const localPath = `${LOCAL_TEMP_DIR}/${filename}`;

  try {
    execSync(`gsutil cp "${gcsPath}" "${localPath}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const content = readFileSync(localPath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Upload VWAP data to GCS
 */
function uploadVWAPToGCS(ticker: string, fnarExchange: string): boolean {
  const filename = `${ticker}-${fnarExchange}-vwap.json`;
  const localPath = `${LOCAL_TEMP_DIR}/${filename}`;
  const gcsPath = `gs://${GCS_BUCKET}/${GCS_VWAP_PATH}/${filename}`;

  try {
    execSync(`gsutil -h "Cache-Control:public, max-age=3600" cp "${localPath}" "${gcsPath}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Expand data to include all calendar days from first date to endDate
 */
function expandToAllDays(rawDataPoints: RawDataPoint[], endDate?: number): RawDataPoint[] {
  if (rawDataPoints.length === 0) return [];

  const sorted = [...rawDataPoints].sort((a, b) => a.DateEpochMs - b.DateEpochMs);
  const firstDate = sorted[0].DateEpochMs;
  // Use provided endDate or fall back to last date in raw data
  const lastDate = endDate !== undefined ? endDate : sorted[sorted.length - 1].DateEpochMs;

  const dataMap = new Map<number, RawDataPoint>();
  for (const point of sorted) {
    const dayStart = Math.floor(point.DateEpochMs / 86400000) * 86400000;
    dataMap.set(dayStart, point);
  }

  const expanded: RawDataPoint[] = [];
  const oneDayMs = 86400000;

  for (let date = Math.floor(firstDate / oneDayMs) * oneDayMs; date <= lastDate; date += oneDayMs) {
    if (dataMap.has(date)) {
      expanded.push(dataMap.get(date)!);
    } else {
      expanded.push({
        DateEpochMs: date,
        Open: 0,
        Close: 0,
        High: 0,
        Low: 0,
        Volume: 0,
        Traded: 0,
      });
    }
  }

  return expanded;
}

/**
 * Calculate VWAP for recent dates only (incremental update)
 */
function calculateIncrementalVWAP(
  rawData: RawHistoricalData,
  targetTimestamp: number
): { newData: VWAPDataPoint[]; startTimestamp: number } {
  // Calculate date range to process
  const oneDayMs = 86400000;
  const startTimestamp = targetTimestamp - (CALCULATION_WINDOW * oneDayMs);

  // IMPORTANT: We need extra data for lookback calculations
  // - 7 days for reference price calculation
  // - 7 days for vwap7d window
  // Total extra: 14 days, but use 20 for safety
  const LOOKBACK_BUFFER = 20;
  const dataStartTimestamp = startTimestamp - (LOOKBACK_BUFFER * oneDayMs);

  // Expand raw data to target timestamp, then filter to include lookback buffer
  const expandedData = expandToAllDays(rawData.data, targetTimestamp);
  const filteredData = expandedData.filter(
    (d) => d.DateEpochMs >= dataStartTimestamp && d.DateEpochMs <= targetTimestamp
  );

  if (filteredData.length === 0) {
    return { newData: [], startTimestamp };
  }

  const vwapData: VWAPDataPoint[] = [];
  let clippedDays = 0;
  let forwardFilledDays = 0;
  let lastValidVWAP: number | null = null;

  // Step 1: Calculate Daily VWAP
  const dailyVWAPs: (number | null)[] = [];
  let lastValidDailyVWAP: number | null = null;

  for (const d of filteredData) {
    if (d.Traded > 0 && d.Volume > 0) {
      const vwap = d.Volume / d.Traded;
      dailyVWAPs.push(vwap);
      lastValidDailyVWAP = vwap;
    } else if (lastValidDailyVWAP !== null) {
      dailyVWAPs.push(lastValidDailyVWAP);
    } else {
      dailyVWAPs.push(null);
    }
  }

  // Pre-calculate clipped daily VWAPs for all days using 5x rule
  const clippedDailyVWAPsArray: (number | null)[] = [];

  // Step 2: Process each day
  for (let i = 0; i < filteredData.length; i++) {
    const day = filteredData[i];
    const dailyVWAP = dailyVWAPs[i];

    // Determine reference price for 5x clipping rule
    let referencePrice: number | null = null;
    let lowerFloor: number | null = null;
    let upperCap: number | null = null;

    if (i >= 7) {
      // Use prior 7-day VWAP as reference (days i-7 to i-1, not including today)
      let sumValue = 0;
      let sumTraded = 0;
      for (let j = i - 7; j < i; j++) {
        const dayData = filteredData[j];
        const dayClippedVWAP = clippedDailyVWAPsArray[j];
        if (dayData.Traded > 0 && dayClippedVWAP !== null) {
          sumValue += dayClippedVWAP * dayData.Traded;
          sumTraded += dayData.Traded;
        }
      }
      if (sumTraded > 0) {
        referencePrice = sumValue / sumTraded;
      } else {
        // No trades in prior 7 days, use last available clipped VWAP
        for (let j = i - 1; j >= 0; j--) {
          if (clippedDailyVWAPsArray[j] !== null) {
            referencePrice = clippedDailyVWAPsArray[j];
            break;
          }
        }
      }
    } else if (i >= 1) {
      // Use prior day's clipped VWAP as reference
      referencePrice = clippedDailyVWAPsArray[i - 1];
    }
    // If i === 0 (first day), no clipping - referencePrice stays null

    // Calculate fences based on reference price
    if (referencePrice !== null) {
      lowerFloor = referencePrice / 5;
      upperCap = referencePrice * 5;
    }

    // Apply clipping
    let clippedDailyVWAP: number | null = null;
    if (dailyVWAP !== null && referencePrice !== null && lowerFloor !== null && upperCap !== null) {
      clippedDailyVWAP = Math.max(lowerFloor, Math.min(dailyVWAP, upperCap));
      if (clippedDailyVWAP !== dailyVWAP) {
        clippedDays++;
      }
    } else if (dailyVWAP !== null) {
      // No reference yet (first day), use raw VWAP
      clippedDailyVWAP = dailyVWAP;
    }

    // Store clipped value for use in subsequent days' reference price calculation
    clippedDailyVWAPsArray.push(clippedDailyVWAP);

    // Calculate 7-day rolling VWAP (available from day 0)
    let vwap7d: number | null = null;
    let tradingDaysInWindow = 0;
    let wasForwardFilled = false;

    if (i >= 0) { // Calculate from day 1 (changed from requiring 30 days)
      let sumClippedValue = 0;
      let sumTraded = 0;

      // Look at available days (up to 7)
      const windowStart = Math.max(0, i - 6);
      for (let j = windowStart; j <= i; j++) {
        const dayData = filteredData[j];
        const dayClippedVWAP = clippedDailyVWAPsArray[j];

        if (dayData.Traded > 0 && dayClippedVWAP !== null) {
          const clippedValue = dayClippedVWAP * dayData.Traded;
          sumClippedValue += clippedValue;
          sumTraded += dayData.Traded;
          tradingDaysInWindow++;
        }
      }

      if (sumTraded > 0) {
        vwap7d = sumClippedValue / sumTraded;
        lastValidVWAP = vwap7d;
      } else if (lastValidVWAP !== null) {
        vwap7d = lastValidVWAP;
        wasForwardFilled = true;
        forwardFilledDays++;
      }
    }

    // Calculate 7-day and 30-day traded sums
    let traded7d = 0;
    let traded30d = 0;

    // 7-day sum (last 7 days including today)
    for (let j = Math.max(0, i - 6); j <= i; j++) {
      traded7d += filteredData[j].Traded;
    }

    // 30-day sum (last 30 days including today)
    for (let j = Math.max(0, i - 29); j <= i; j++) {
      traded30d += filteredData[j].Traded;
    }

    const averageTraded7d = traded7d / 7;
    const averageTraded30d = traded30d / 30;

    vwapData.push({
      DateEpochMs: day.DateEpochMs,
      rawVolume: day.Volume,
      rawTraded: day.Traded,
      rawOpen: day.Open,
      rawClose: day.Close,
      rawHigh: day.High,
      rawLow: day.Low,
      dailyVWAP,
      referencePrice,
      lowerFloor,
      upperCap,
      clippedDailyVWAP,
      vwap7d,
      tradingDaysInWindow,
      wasForwardFilled,
      traded7d,
      traded30d,
      averageTraded7d,
      averageTraded30d,
    });
  }

  // Filter to only return dates from startTimestamp onwards (exclude lookback buffer)
  // The lookback buffer was used for calculation but shouldn't be merged into output
  const dataToMerge = vwapData.filter((d) => d.DateEpochMs >= startTimestamp);

  return { newData: dataToMerge, startTimestamp };
}

/**
 * Merge new VWAP data with existing data
 */
function mergeVWAPData(
  existingData: VWAPHistoricalData | null,
  newData: VWAPDataPoint[],
  startTimestamp: number,
  ticker: string,
  exchange: string
): VWAPHistoricalData {
  if (!existingData) {
    // No existing data, create new structure
    const tradingDays = newData.filter((d) => d.dailyVWAP !== null).length;
    const clippedDays = newData.filter(
      (d) => d.clippedDailyVWAP !== null && d.dailyVWAP !== null && d.clippedDailyVWAP !== d.dailyVWAP
    ).length;
    const forwardFilledDays = newData.filter((d) => d.wasForwardFilled).length;
    const validVWAPs = newData.filter((d) => d.vwap7d !== null && !d.wasForwardFilled);
    const avgVWAP7d =
      validVWAPs.length > 0 ? validVWAPs.reduce((sum, d) => sum + (d.vwap7d || 0), 0) / validVWAPs.length : null;

    return {
      ticker,
      exchange,
      calculationVersion: "1.0",
      lastCalculated: Date.now(),
      data: newData,
      statistics: {
        totalDays: newData.length,
        tradingDays,
        clippedDays,
        forwardFilledDays,
        avgVWAP7d,
      },
    };
  }

  // Merge: keep old data before startTimestamp, replace/append new data
  const oldData = existingData.data.filter((d) => d.DateEpochMs < startTimestamp);
  const mergedData = [...oldData, ...newData];

  // Sort by date
  mergedData.sort((a, b) => a.DateEpochMs - b.DateEpochMs);

  // Recalculate statistics
  const tradingDays = mergedData.filter((d) => d.dailyVWAP !== null).length;
  const clippedDays = mergedData.filter(
    (d) => d.clippedDailyVWAP !== null && d.dailyVWAP !== null && d.clippedDailyVWAP !== d.dailyVWAP
  ).length;
  const forwardFilledDays = mergedData.filter((d) => d.wasForwardFilled).length;
  const validVWAPs = mergedData.filter((d) => d.vwap7d !== null && !d.wasForwardFilled);
  const avgVWAP7d =
    validVWAPs.length > 0 ? validVWAPs.reduce((sum, d) => sum + (d.vwap7d || 0), 0) / validVWAPs.length : null;

  return {
    ...existingData,
    lastCalculated: Date.now(),
    data: mergedData,
    statistics: {
      totalDays: mergedData.length,
      tradingDays,
      clippedDays,
      forwardFilledDays,
      avgVWAP7d,
    },
  };
}

/**
 * Main update function
 */
async function updateDailyVWAP(dryRun: boolean = false) {
  console.log("\n🔄 Daily Incremental VWAP Update");
  console.log("=".repeat(60));

  const { timestamp: targetTimestamp, isoDate: targetDate } = getTargetDate();
  console.log(`📅 Target date: ${targetDate} (${LOOKBACK_DAYS} days ago)`);
  console.log(`📊 Recalculation window: ${CALCULATION_WINDOW} days`);
  console.log(`🔧 Dry run: ${dryRun ? "YES" : "NO"}`);
  console.log();

  // Create local temp directory
  mkdirSync(LOCAL_TEMP_DIR, { recursive: true });

  // Load tickers
  const tickers = loadTickersFromFile("scripts/config/tickers.txt");
  const totalEndpoints = tickers.length * EXCHANGES.length;
  console.log(`📊 Processing ${tickers.length} tickers × ${EXCHANGES.length} exchanges = ${totalEndpoints} endpoints\n`);

  const startTime = Date.now();
  const results: Array<{
    ticker: string;
    exchange: string;
    success: boolean;
    updated: boolean;
    replacedForwardFill?: boolean;
    newDataPoints?: number;
    error?: string;
  }> = [];

  // Build list of all endpoints
  const endpoints: Array<{ ticker: string; exchange: keyof typeof EXCHANGE_MAP }> = [];
  for (const ticker of tickers) {
    for (const exchange of EXCHANGES) {
      endpoints.push({ ticker, exchange });
    }
  }

  // Process in batches
  const batchSize = 10;
  const totalBatches = Math.ceil(endpoints.length / batchSize);

  for (let i = 0; i < endpoints.length; i += batchSize) {
    const batch = endpoints.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    console.log(`\n🔄 Processing batch ${batchNum}/${totalBatches} (${batch.length} endpoints)...`);

    for (const { ticker, exchange } of batch) {
      const fnarExchange = EXCHANGE_MAP[exchange];

      try {
        // Download raw data
        const rawData = downloadRawDataFromGCS(ticker, fnarExchange);
        if (!rawData) {
          results.push({
            ticker,
            exchange,
            success: false,
            updated: false,
            error: "No raw data found",
          });
          continue;
        }

        // Check if raw data has the target date
        const hasTargetDate = rawData.data.some((d) => d.DateEpochMs === targetTimestamp);
        if (!hasTargetDate) {
          results.push({
            ticker,
            exchange,
            success: true,
            updated: false,
          });
          continue;
        }

        // Download existing VWAP data
        const existingVWAP = downloadVWAPFromGCS(ticker, fnarExchange);

        // Check if VWAP already has target date with REAL data (not forward-filled)
        let isReplacingForwardFill = false;
        if (existingVWAP) {
          const existingPoint = existingVWAP.data.find((d) => d.DateEpochMs === targetTimestamp);
          if (existingPoint && !existingPoint.wasForwardFilled) {
            // Has real data, safe to skip
            results.push({
              ticker,
              exchange,
              success: true,
              updated: false,
            });
            continue;
          } else if (existingPoint && existingPoint.wasForwardFilled) {
            // Has forward-filled data, will replace with real data
            isReplacingForwardFill = true;
            console.log(`   🔄 ${ticker}.${exchange}: Replacing forward-filled data with real data`);
          }
          // Either no data or forward-filled, proceed with recalculation
        }

        // Calculate VWAP for recent dates
        const { newData, startTimestamp } = calculateIncrementalVWAP(rawData, targetTimestamp);

        if (newData.length === 0) {
          results.push({
            ticker,
            exchange,
            success: true,
            updated: false,
          });
          continue;
        }

        // Merge with existing data
        const mergedVWAP = mergeVWAPData(existingVWAP, newData, startTimestamp, ticker, fnarExchange);

        // Save locally
        const filename = `${ticker}-${fnarExchange}-vwap.json`;
        const localPath = `${LOCAL_TEMP_DIR}/${filename}`;
        writeFileSync(localPath, JSON.stringify(mergedVWAP, null, 2));

        // Upload to GCS (unless dry run)
        if (!dryRun) {
          const uploaded = uploadVWAPToGCS(ticker, fnarExchange);
          if (!uploaded) {
            results.push({
              ticker,
              exchange,
              success: false,
              updated: false,
              error: "Failed to upload",
            });
            continue;
          }
        }

        results.push({
          ticker,
          exchange,
          success: true,
          updated: true,
          replacedForwardFill: isReplacingForwardFill,
          newDataPoints: newData.length,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({
          ticker,
          exchange,
          success: false,
          updated: false,
          error: errorMsg,
        });
      }
    }

    // Progress update
    const completed = i + batch.length;
    const percent = ((completed / endpoints.length) * 100).toFixed(1);
    console.log(`   Progress: ${completed}/${endpoints.length} (${percent}%)`);

    // Delay between batches
    if (i + batchSize < endpoints.length) {
      await sleep(1000);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log(`✅ Update complete in ${duration}s`);
  console.log("=".repeat(60));

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const updated = results.filter((r) => r.updated).length;
  const skipped = results.filter((r) => r.success && !r.updated).length;
  const replacedForwardFill = results.filter((r) => r.replacedForwardFill).length;

  console.log(`\n📊 Summary:`);
  console.log(`   Target date: ${targetDate}`);
  console.log(`   Total endpoints: ${results.length}`);
  console.log(`   ✅ Successful: ${successful}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📥 Updated: ${updated}`);
  console.log(`   🔄 Replaced forward-filled: ${replacedForwardFill}`);
  console.log(`   ⏭️  Skipped (already have real data): ${skipped}`);

  if (failed > 0) {
    console.log(`\n⚠️  Failed updates:`);
    results
      .filter((r) => !r.success)
      .slice(0, 10)
      .forEach((r) => {
        console.log(`   - ${r.ticker}.${r.exchange}: ${r.error}`);
      });
    if (failed > 10) {
      console.log(`   ... and ${failed - 10} more`);
    }
  }

  if (dryRun) {
    console.log(`\n🔧 DRY RUN: No files uploaded to GCS`);
  }

  console.log();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// Run the script
updateDailyVWAP(dryRun).catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

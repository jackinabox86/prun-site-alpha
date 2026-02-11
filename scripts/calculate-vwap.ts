import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { execSync } from "child_process";

/**
 * Calculate 7-Day Rolling Volume-Weighted Average Price (VWAP)
 * with outlier detection and clipping
 *
 * Methodology:
 * 1. Calculate Daily VWAP = Volume / Traded
 * 2. Determine reference price:
 *    - Days 7+: prior 7-day VWAP (days i-7 to i-1)
 *    - Days 1-6: prior day's VWAP
 *    - Day 0: no clipping (first trading day)
 * 3. Apply 5x clipping rule:
 *    - LowerFloor = referencePrice / 5
 *    - UpperCap = referencePrice * 5
 *    - Clipped_VWAP = max(LowerFloor, min(DailyVWAP, UpperCap))
 * 4. Reconstruct clipped value: Clipped_Value = Clipped_VWAP × Traded
 * 5. Calculate 7-day VWAP = Σ(Clipped_Value) / Σ(Traded) over 7 days
 * 6. Forward-fill for zero-volume periods
 *
 * Output: JSON files in GCS historical-prices-vwap/ folder
 */

interface RawDataPoint {
  DateEpochMs: number;
  Open: number;
  Close: number;
  High: number;
  Low: number;
  Volume: number;  // Total value in credits
  Traded: number;  // Number of units
}

interface RawHistoricalData {
  ticker: string;
  exchange: string;
  lastUpdated: number;
  data: RawDataPoint[];
}

interface VWAPDataPoint {
  DateEpochMs: number;

  // Raw data
  rawVolume: number;
  rawTraded: number;
  rawOpen: number;
  rawClose: number;
  rawHigh: number;
  rawLow: number;

  // Calculated daily VWAP
  dailyVWAP: number | null;  // Volume / Traded

  // Reference price for clipping (prior 7-day VWAP or prior daily VWAP)
  referencePrice: number | null;

  // Outlier fences (5x rule: lowerFloor = referencePrice/5, upperCap = referencePrice*5)
  lowerFloor: number | null;
  upperCap: number | null;

  // Clipped price
  clippedDailyVWAP: number | null;

  // 7-day rolling VWAP
  vwap7d: number | null;
  tradingDaysInWindow: number;
  wasForwardFilled: boolean;

  // Rolling traded sums and averages
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

// Load tickers from file
function loadTickersFromFile(filepath: string): string[] {
  try {
    const content = readFileSync(filepath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch (error) {
    console.error(`❌ Failed to load tickers from ${filepath}`);
    throw error;
  }
}

// Expand data to include all calendar days from first date to endDate
function expandToAllDays(rawDataPoints: RawDataPoint[], endDate?: number): RawDataPoint[] {
  if (rawDataPoints.length === 0) return [];

  // Sort by date to ensure chronological order
  const sorted = [...rawDataPoints].sort((a, b) => a.DateEpochMs - b.DateEpochMs);

  const firstDate = sorted[0].DateEpochMs;
  // Use provided endDate or fall back to last date in raw data
  const lastDate = endDate !== undefined ? endDate : sorted[sorted.length - 1].DateEpochMs;

  // Create a map of existing data points by date
  const dataMap = new Map<number, RawDataPoint>();
  for (const point of sorted) {
    // Normalize to start of day (midnight UTC)
    const dayStart = Math.floor(point.DateEpochMs / 86400000) * 86400000;
    dataMap.set(dayStart, point);
  }

  // Generate all days from first to last (or endDate)
  const expanded: RawDataPoint[] = [];
  const oneDayMs = 86400000; // 24 hours in milliseconds

  for (let date = Math.floor(firstDate / oneDayMs) * oneDayMs;
       date <= lastDate;
       date += oneDayMs) {

    if (dataMap.has(date)) {
      // Use existing data
      expanded.push(dataMap.get(date)!);
    } else {
      // Create synthetic entry for missing day with zero trading activity
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

function calculateVWAP(
  ticker: string,
  exchange: string,
  rawData: RawHistoricalData
): VWAPHistoricalData {
  console.log(`\n📊 Calculating VWAP for ${ticker}.${exchange}`);
  console.log(`   Raw data points: ${rawData.data.length}`);

  // Calculate cutoff date: stop 4 days before today to allow late-arriving data
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const cutoffDate = new Date(today);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 4);
  const cutoffTimestamp = cutoffDate.getTime();

  // Expand data to include ALL calendar days from first date to cutoff date
  const expandedData = expandToAllDays(rawData.data, cutoffTimestamp);
  console.log(`   Expanded to ${expandedData.length} days (including gaps, up to cutoff)`);

  // Filter to only include dates up to cutoff (should be a no-op now, but kept for safety)
  const filteredData = expandedData.filter(d => d.DateEpochMs <= cutoffTimestamp);

  if (filteredData.length < expandedData.length) {
    const excluded = expandedData.length - filteredData.length;
    console.log(`   ⏸️  Excluded ${excluded} recent days (cutoff: ${cutoffDate.toISOString().split('T')[0]})`);
    console.log(`   Processing ${filteredData.length} days (up to 4 days before today)`);
  }

  const vwapData: VWAPDataPoint[] = [];
  let clippedDays = 0;
  let forwardFilledDays = 0;
  let lastValidVWAP: number | null = null;

  // Step 1: Calculate Daily VWAP for all days with forward-fill for zero-traded days
  const dailyVWAPs: (number | null)[] = [];
  let lastValidDailyVWAP: number | null = null;

  for (const d of filteredData) {
    if (d.Traded > 0 && d.Volume > 0) {
      const vwap = d.Volume / d.Traded;
      dailyVWAPs.push(vwap);
      lastValidDailyVWAP = vwap;
    } else if (lastValidDailyVWAP !== null) {
      // Forward-fill Daily VWAP on zero-traded days
      dailyVWAPs.push(lastValidDailyVWAP);
    } else {
      // No prior value to forward-fill from
      dailyVWAPs.push(null);
    }
  }

  const tradingDaysCount = filteredData.filter(d => d.Traded > 0).length;
  const forwardFilledDailyCount = dailyVWAPs.filter((v, i) => v !== null && filteredData[i].Traded === 0).length;
  console.log(`   Days with trading activity: ${tradingDaysCount}`);

  // Pre-calculate clipped daily VWAPs for all days using 5x rule
  // This array stores the clipped values to be used in vwap7d calculation
  const clippedDailyVWAPsArray: (number | null)[] = [];

  // Process each day
  for (let i = 0; i < filteredData.length; i++) {
    const day = filteredData[i];
    const dailyVWAP = dailyVWAPs[i];

    // Determine reference price for 5x clipping rule
    let referencePrice: number | null = null;
    let lowerFloor: number | null = null;
    let upperCap: number | null = null;

    if (i >= 7) {
      // Use prior 7-day VWAP as reference (days i-7 to i-1, not including today)
      // Calculate volume-weighted average of days i-7 to i-1
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

    // Apply clipping to daily VWAP
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
          // Reconstruct clipped value
          const clippedValue = dayClippedVWAP * dayData.Traded;
          sumClippedValue += clippedValue;
          sumTraded += dayData.Traded;
          tradingDaysInWindow++;
        }
      }

      // Calculate VWAP if we have any trades
      if (sumTraded > 0) {
        vwap7d = sumClippedValue / sumTraded;
        lastValidVWAP = vwap7d;
      } else if (lastValidVWAP !== null) {
        // Forward-fill if no trades in 7-day window
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

  // Calculate statistics
  const tradingDays = vwapData.filter(d => d.dailyVWAP !== null).length;
  const validVWAPs = vwapData.filter(d => d.vwap7d !== null && !d.wasForwardFilled);
  const avgVWAP7d = validVWAPs.length > 0
    ? validVWAPs.reduce((sum, d) => sum + (d.vwap7d || 0), 0) / validVWAPs.length
    : null;

  console.log(`   ✅ Calculation complete`);
  console.log(`   Trading days: ${tradingDays}/${vwapData.length}`);
  console.log(`   Forward-filled daily VWAPs: ${forwardFilledDailyCount}`);
  console.log(`   Clipped days: ${clippedDays}`);
  console.log(`   Forward-filled 7-day VWAPs: ${forwardFilledDays}`);
  console.log(`   Avg 7-day VWAP: ${avgVWAP7d ? avgVWAP7d.toFixed(2) : 'N/A'}`);

  return {
    ticker,
    exchange,
    calculationVersion: "1.0",
    lastCalculated: Date.now(),
    data: vwapData,
    statistics: {
      totalDays: vwapData.length,
      tradingDays,
      clippedDays,
      forwardFilledDays,
      avgVWAP7d,
    },
  };
}

interface VWAPConfig {
  tickers: string[];
  exchanges: Array<keyof typeof EXCHANGE_MAP>;
  gcsBucket: string;
  gcsInputPath: string;
  gcsOutputPath: string;
  batchSize: number;
  delayMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Detect branch for output path
function getCurrentBranch(): string {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (branch && branch !== "HEAD") return branch;
  } catch {}
  return "unknown";
}

function isProductionBranch(branch: string): boolean {
  return branch === "main";
}

async function calculateVWAPForTicker(
  ticker: string,
  fnarExchange: string,
  gcsBucket: string,
  gcsInputPath: string,
  gcsOutputPath: string
): Promise<{ ticker: string; exchange: string; success: boolean; dataPoints?: number }> {
  const exchangeCode = Object.keys(EXCHANGE_MAP).find(
    key => EXCHANGE_MAP[key as keyof typeof EXCHANGE_MAP] === fnarExchange
  ) || fnarExchange.toUpperCase();

  try {
    // Load raw historical data from GCS using gsutil
    const gcsInput = `gs://${gcsBucket}/${gcsInputPath}/${ticker}-${fnarExchange}.json`;
    const tempInputFile = `/tmp/${ticker}-${fnarExchange}-input.json`;

    execSync(`gsutil cp ${gcsInput} ${tempInputFile}`, {
      stdio: ["pipe", "pipe", "pipe"] // Suppress output
    });

    const rawData: RawHistoricalData = JSON.parse(
      readFileSync(tempInputFile, "utf8")
    );

    // Calculate VWAP
    const vwapData = calculateVWAP(ticker, fnarExchange, rawData);

    // Save output to GCS using gsutil
    const tempFile = `/tmp/${ticker}-${fnarExchange}-vwap.json`;
    writeFileSync(tempFile, JSON.stringify(vwapData, null, 2));

    const gcsOutput = `gs://${gcsBucket}/${gcsOutputPath}/${ticker}-${fnarExchange}-vwap.json`;
    execSync(`gsutil -h "Cache-Control:public, max-age=3600" cp ${tempFile} ${gcsOutput}`, {
      stdio: ["pipe", "pipe", "pipe"] // Suppress output
    });

    console.log(`   ✅ ${ticker}.${exchangeCode}: ${vwapData.data.length} days, ${vwapData.statistics.forwardFilledDays} forward-filled`);
    return { ticker, exchange: exchangeCode, success: true, dataPoints: vwapData.data.length };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(`   ❌ ${ticker}.${exchangeCode}: ${errorMsg}`);
    return { ticker, exchange: exchangeCode, success: false };
  }
}

async function calculateAllVWAP(config: VWAPConfig) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 VWAP Calculation Script`);
  console.log(`${"=".repeat(60)}`);

  const startTime = Date.now();
  const results: Array<{ ticker: string; exchange: string; success: boolean; dataPoints?: number }> = [];

  // Build list of all endpoints to process
  const endpoints: Array<{ ticker: string; exchange: keyof typeof EXCHANGE_MAP }> = [];
  for (const ticker of config.tickers) {
    for (const exchange of config.exchanges) {
      endpoints.push({ ticker, exchange });
    }
  }

  console.log(`\n   Tickers: ${config.tickers.length}`);
  console.log(`   Exchanges: ${config.exchanges.join(", ")}`);
  console.log(`   Total endpoints: ${endpoints.length}`);
  console.log(`   Batch size: ${config.batchSize}`);

  // Process in batches
  const totalBatches = Math.ceil(endpoints.length / config.batchSize);

  for (let i = 0; i < endpoints.length; i += config.batchSize) {
    const batch = endpoints.slice(i, i + config.batchSize);
    const batchNum = Math.floor(i / config.batchSize) + 1;

    console.log(`\n🔄 Processing batch ${batchNum}/${totalBatches} (${batch.length} endpoints)...`);

    // Process batch in parallel
    const batchPromises = batch.map(async ({ ticker, exchange }) => {
      const fnarExchange = EXCHANGE_MAP[exchange];
      return calculateVWAPForTicker(
        ticker,
        fnarExchange,
        config.gcsBucket,
        config.gcsInputPath,
        config.gcsOutputPath
      );
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Progress update
    const completed = i + batch.length;
    const percent = ((completed / endpoints.length) * 100).toFixed(1);
    console.log(`   Progress: ${completed}/${endpoints.length} (${percent}%)`);

    // Delay between batches (except for last batch)
    if (i + config.batchSize < endpoints.length) {
      console.log(`   ⏳ Waiting ${config.delayMs}ms before next batch...`);
      await sleep(config.delayMs);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log(`✅ VWAP calculation complete in ${duration}s`);
  console.log("=".repeat(60));

  // Summary
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\n📊 Summary:`);
  console.log(`   Total: ${results.length}`);
  console.log(`   ✅ Successful: ${successful}`);
  console.log(`   ❌ Failed: ${failed}`);

  if (successful > 0) {
    const totalDataPoints = results
      .filter((r) => r.success && r.dataPoints)
      .reduce((sum, r) => sum + (r.dataPoints || 0), 0);
    const avgDataPoints = totalDataPoints / successful;
    console.log(`   📊 Total data points: ${totalDataPoints.toLocaleString()}`);
    console.log(`   📊 Avg per endpoint: ${avgDataPoints.toFixed(0)} days`);
  }

  if (failed > 0) {
    console.log(`\n⚠️  Failed calculations:`);
    results
      .filter((r) => !r.success)
      .slice(0, 10) // Show first 10 failures
      .forEach((r) => {
        console.log(`   - ${r.ticker}.${r.exchange}`);
      });
    if (failed > 10) {
      console.log(`   ... and ${failed - 10} more`);
    }
  }

  // Write summary to GCS
  const summaryData = {
    timestamp: new Date().toISOString(),
    branch: CURRENT_BRANCH,
    mode: IS_PRODUCTION ? "production" : "test",
    configuration: {
      tickers: config.tickers.length,
      exchanges: config.exchanges,
      batchSize: config.batchSize,
      delayMs: config.delayMs,
      gcsBucket: config.gcsBucket,
      gcsInputPath: config.gcsInputPath,
      gcsOutputPath: config.gcsOutputPath,
    },
    results: {
      total: results.length,
      successful,
      failed,
      durationSeconds: parseFloat(duration),
    },
    dataPoints: {
      total: successful > 0 ? results
        .filter((r) => r.success && r.dataPoints)
        .reduce((sum, r) => sum + (r.dataPoints || 0), 0) : 0,
      averagePerEndpoint: successful > 0 ? results
        .filter((r) => r.success && r.dataPoints)
        .reduce((sum, r) => sum + (r.dataPoints || 0), 0) / successful : 0,
    },
    failures: results
      .filter((r) => !r.success)
      .map((r) => ({ ticker: r.ticker, exchange: r.exchange })),
  };

  try {
    const summaryTempFile = `/tmp/vwap-calculation-summary.json`;
    writeFileSync(summaryTempFile, JSON.stringify(summaryData, null, 2));

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const gcsSummaryPath = `gs://${config.gcsBucket}/${config.gcsOutputPath}/calculation-summary-${timestamp}.json`;

    execSync(`gsutil -h "Cache-Control:public, max-age=3600" cp ${summaryTempFile} ${gcsSummaryPath}`, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    console.log(`\n📝 Summary saved to GCS:`);
    console.log(`   ${gcsSummaryPath}`);
  } catch (error) {
    console.error(`\n⚠️  Failed to save summary to GCS: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log();
}

// Main execution
const CURRENT_BRANCH = getCurrentBranch();
const IS_PRODUCTION = isProductionBranch(CURRENT_BRANCH);

// Configuration options
// Uncomment the one you want to use:

// Option 1: Single ticker for testing
// const CONFIG: VWAPConfig = {
//   tickers: ["RAT"],
//   exchanges: ["ANT"],
//   gcsBucket: "prun-site-alpha-bucket",
//   gcsInputPath: "historical-prices",
//   gcsOutputPath: IS_PRODUCTION
//     ? "historical-prices-vwap"
//     : `historical-prices-vwap-test/${CURRENT_BRANCH}`,
//   batchSize: 1,
//   delayMs: 500,
// };

// Option 2: All tickers from file × all exchanges
const CONFIG: VWAPConfig = {
  tickers: loadTickersFromFile("scripts/config/tickers.txt"),
  exchanges: ["ANT", "CIS", "ICA", "NCC"],
  gcsBucket: "prun-site-alpha-bucket",
  gcsInputPath: "historical-prices",
  gcsOutputPath: IS_PRODUCTION
    ? "historical-prices-vwap"
    : `historical-prices-vwap-test/${CURRENT_BRANCH}`,
  batchSize: 10, // 10 concurrent calculations
  delayMs: 1000, // 1 second between batches
};

console.log(`\n🚀 VWAP Calculation Script`);
console.log(`   Branch: ${CURRENT_BRANCH}`);
console.log(`   Mode: ${IS_PRODUCTION ? "🟢 PRODUCTION" : "🟡 TEST"}`);

calculateAllVWAP(CONFIG).catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

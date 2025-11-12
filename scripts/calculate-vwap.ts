import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";

/**
 * Calculate 7-Day Rolling Volume-Weighted Average Price (VWAP)
 * with outlier detection and clipping
 *
 * Methodology:
 * 1. Calculate Daily VWAP = Volume / Traded
 * 2. Establish 30-day rolling median, Q1, Q3, IQR baseline
 * 3. Define UpperCap = Q3 + 3*IQR, LowerFloor = Q1 - 3*IQR
 * 4. Clip daily prices: Clipped_VWAP = max(LowerFloor, min(DailyVWAP, UpperCap))
 * 5. Reconstruct clipped value: Clipped_Value = Clipped_VWAP × Traded
 * 6. Calculate 7-day VWAP = Σ(Clipped_Value) / Σ(Traded) over 7 days
 * 7. Forward-fill for zero-volume periods
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

  // 30-day rolling statistics
  rollingMedian30d: number | null;
  rollingQ1_30d: number | null;
  rollingQ3_30d: number | null;
  rollingIQR_30d: number | null;

  // Outlier fences
  lowerFloor: number | null;
  upperCap: number | null;

  // Clipped price
  clippedDailyVWAP: number | null;

  // 7-day rolling VWAP
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
  statistics: {
    totalDays: number;
    tradingDays: number;
    clippedDays: number;
    forwardFilledDays: number;
    avgVWAP7d: number | null;
  };
}

// Statistical helper functions
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function calculateQuartiles(values: number[]): { q1: number; q3: number } {
  if (values.length < 4) return { q1: values[0] || 0, q3: values[values.length - 1] || 0 };

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  // Q1 is 25th percentile
  const q1Index = Math.floor(n * 0.25);
  const q1 = sorted[q1Index];

  // Q3 is 75th percentile
  const q3Index = Math.floor(n * 0.75);
  const q3 = sorted[q3Index];

  return { q1, q3 };
}

function calculateVWAP(
  ticker: string,
  exchange: string,
  rawData: RawHistoricalData
): VWAPHistoricalData {
  console.log(`\n📊 Calculating VWAP for ${ticker}.${exchange}`);
  console.log(`   Raw data points: ${rawData.data.length}`);

  const vwapData: VWAPDataPoint[] = [];
  let clippedDays = 0;
  let forwardFilledDays = 0;
  let lastValidVWAP: number | null = null;

  // Step 1: Calculate Daily VWAP for all days with forward-fill for zero-traded days
  const dailyVWAPs: (number | null)[] = [];
  let lastValidDailyVWAP: number | null = null;

  for (const d of rawData.data) {
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

  const tradingDaysCount = rawData.data.filter(d => d.Traded > 0).length;
  const forwardFilledDailyCount = dailyVWAPs.filter((v, i) => v !== null && rawData.data[i].Traded === 0).length;
  console.log(`   Days with trading activity: ${tradingDaysCount}`);

  // Process each day
  for (let i = 0; i < rawData.data.length; i++) {
    const day = rawData.data[i];
    const dailyVWAP = dailyVWAPs[i];

    // Calculate 30-day rolling statistics (need at least 30 days)
    let rollingMedian30d: number | null = null;
    let rollingQ1_30d: number | null = null;
    let rollingQ3_30d: number | null = null;
    let rollingIQR_30d: number | null = null;
    let lowerFloor: number | null = null;
    let upperCap: number | null = null;

    if (i >= 29) {
      // Get last 30 days of valid VWAPs
      const window30d = dailyVWAPs
        .slice(i - 29, i + 1)
        .filter((v): v is number => v !== null);

      if (window30d.length >= 15) { // Require at least 15 trading days in 30-day window
        rollingMedian30d = calculateMedian(window30d);
        const { q1, q3 } = calculateQuartiles(window30d);
        rollingQ1_30d = q1;
        rollingQ3_30d = q3;
        rollingIQR_30d = q3 - q1;

        // Calculate outlier fences
        lowerFloor = q1 - 3 * rollingIQR_30d;
        upperCap = q3 + 3 * rollingIQR_30d;
      }
    }

    // Apply clipping to daily VWAP
    let clippedDailyVWAP: number | null = null;
    if (dailyVWAP !== null && lowerFloor !== null && upperCap !== null) {
      clippedDailyVWAP = Math.max(lowerFloor, Math.min(dailyVWAP, upperCap));
      if (clippedDailyVWAP !== dailyVWAP) {
        clippedDays++;
      }
    } else if (dailyVWAP !== null) {
      // No fences yet, use raw VWAP
      clippedDailyVWAP = dailyVWAP;
    }

    // Calculate 7-day rolling VWAP (need at least 7 days and 30 days for baseline)
    let vwap7d: number | null = null;
    let tradingDaysInWindow = 0;
    let wasForwardFilled = false;

    if (i >= 6 && i >= 29) { // Need 7 days for rolling + 30 days for baseline
      let sumClippedValue = 0;
      let sumTraded = 0;

      // Look at last 7 days
      for (let j = i - 6; j <= i; j++) {
        const dayData = rawData.data[j];
        const dayVWAP = dailyVWAPs[j];

        if (dayData.Traded > 0 && dayVWAP !== null) {
          // Get the clipped VWAP for this day
          // Need to use the fences calculated at day j, not current day i
          let dayClippedVWAP = dayVWAP;

          // Calculate fences for day j
          if (j >= 29) {
            const window30dForJ = dailyVWAPs
              .slice(j - 29, j + 1)
              .filter((v): v is number => v !== null);

            if (window30dForJ.length >= 15) {
              const { q1, q3 } = calculateQuartiles(window30dForJ);
              const iqr = q3 - q1;
              const lowerFloorJ = q1 - 3 * iqr;
              const upperCapJ = q3 + 3 * iqr;

              dayClippedVWAP = Math.max(lowerFloorJ, Math.min(dayVWAP, upperCapJ));
            }
          }

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

    vwapData.push({
      DateEpochMs: day.DateEpochMs,
      rawVolume: day.Volume,
      rawTraded: day.Traded,
      rawOpen: day.Open,
      rawClose: day.Close,
      rawHigh: day.High,
      rawLow: day.Low,
      dailyVWAP,
      rollingMedian30d,
      rollingQ1_30d,
      rollingQ3_30d,
      rollingIQR_30d,
      lowerFloor,
      upperCap,
      clippedDailyVWAP,
      vwap7d,
      tradingDaysInWindow,
      wasForwardFilled,
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
  exchange: string,
  gcsInputPath: string,
  gcsOutputPath: string
) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Processing: ${ticker}.${exchange}`);
  console.log(`${"=".repeat(60)}`);

  // Load raw historical data from GCS using gsutil
  console.log(`📥 Loading raw data from: ${gcsInputPath}`);
  const tempInputFile = `/tmp/${ticker}-${exchange}-input.json`;
  execSync(`gsutil cp ${gcsInputPath} ${tempInputFile}`, { stdio: "inherit" });

  const rawData: RawHistoricalData = JSON.parse(
    execSync(`cat ${tempInputFile}`, { encoding: "utf8" })
  );

  // Calculate VWAP
  const vwapData = calculateVWAP(ticker, exchange, rawData);

  // Save output to GCS using gsutil
  const tempFile = `/tmp/${ticker}-${exchange}-vwap.json`;
  writeFileSync(tempFile, JSON.stringify(vwapData, null, 2));

  console.log(`📤 Uploading VWAP data to: ${gcsOutputPath}`);
  execSync(`gsutil -h "Cache-Control:public, max-age=3600" cp ${tempFile} ${gcsOutputPath}`, {
    stdio: "inherit",
  });
  console.log(`✅ Upload complete`);
}

// Main execution
const CURRENT_BRANCH = getCurrentBranch();
const IS_PRODUCTION = isProductionBranch(CURRENT_BRANCH);

// Configuration
const ticker = "RAT";
const exchange = "ai1";
const GCS_BUCKET = "prun-site-alpha-bucket";

const gcsInputPath = `gs://${GCS_BUCKET}/historical-prices/${ticker}-${exchange}.json`;

const gcsOutputPath = IS_PRODUCTION
  ? `gs://${GCS_BUCKET}/historical-prices-vwap/${ticker}-${exchange}-vwap.json`
  : `gs://${GCS_BUCKET}/historical-prices-vwap-test/${CURRENT_BRANCH}/${ticker}-${exchange}-vwap.json`;

console.log(`\n🚀 VWAP Calculation Script`);
console.log(`   Branch: ${CURRENT_BRANCH}`);
console.log(`   Mode: ${IS_PRODUCTION ? "🟢 PRODUCTION" : "🟡 TEST"}`);
console.log(`   Input: ${gcsInputPath}`);
console.log(`   Output: ${gcsOutputPath}`);

calculateVWAPForTicker(ticker, exchange, gcsInputPath, gcsOutputPath)
  .then(() => {
    console.log(`\n✅ VWAP calculation complete!`);
    console.log(`   Data uploaded to: ${gcsOutputPath}`);
    console.log();
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });

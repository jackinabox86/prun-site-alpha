import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { ApiRateLimiter } from "./lib/rate-limiter.js";
import type { HistoricalPriceData, MissedDaysLog } from "../src/types";

/**
 * Backfill Historical Price Data for Specific Dates
 *
 * Fetches data for specific dates to fill gaps caused by the previous
 * bug where tickers with no trading activity weren't being logged.
 *
 * Usage:
 *   npm run backfill-dates -- 2024-11-09 2024-11-10 2024-11-11
 *   npm run backfill-dates -- 2024-11-09 2024-11-10 2024-11-11 --dry-run
 */

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
const GCS_DATA_PATH = "historical-prices";
const GCS_MISSED_DAYS_FILE = "historical-prices-missed-days.json";
const LOCAL_DATA_DIR = "public/data/historical-prices";
const LOCAL_MISSED_DAYS_FILE = "public/data/historical-prices-missed-days.json";

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
 * Parse ISO date to timestamp at 00:00 UTC
 */
function parseISODate(isoDate: string): { timestamp: number; isoDate: string } {
  const date = new Date(isoDate + "T00:00:00.000Z");

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${isoDate}. Expected YYYY-MM-DD`);
  }

  return {
    timestamp: date.getTime(),
    isoDate,
  };
}

/**
 * Download file from GCS
 */
function downloadFromGCS(
  ticker: string,
  fnarExchange: string
): HistoricalPriceData | null {
  const filename = `${ticker}-${fnarExchange}.json`;
  const gcsPath = `gs://${GCS_BUCKET}/${GCS_DATA_PATH}/${filename}`;
  const localPath = `${LOCAL_DATA_DIR}/${filename}`;

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
 * Upload file to GCS
 */
function uploadToGCS(ticker: string, fnarExchange: string): boolean {
  const filename = `${ticker}-${fnarExchange}.json`;
  const localPath = `${LOCAL_DATA_DIR}/${filename}`;
  const gcsPath = `gs://${GCS_BUCKET}/${GCS_DATA_PATH}/${filename}`;

  try {
    execSync(`gsutil cp "${localPath}" "${gcsPath}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch (error) {
    console.error(`   ❌ Failed to upload ${filename}: ${error}`);
    return false;
  }
}

/**
 * Load missed days log from GCS
 */
function loadMissedDaysLog(): MissedDaysLog {
  const gcsPath = `gs://${GCS_BUCKET}/${GCS_MISSED_DAYS_FILE}`;

  try {
    execSync(`gsutil cp "${gcsPath}" "${LOCAL_MISSED_DAYS_FILE}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const content = readFileSync(LOCAL_MISSED_DAYS_FILE, "utf8");
    return JSON.parse(content);
  } catch (error) {
    return {
      lastUpdated: Date.now(),
      failures: [],
    };
  }
}

/**
 * Save missed days log to GCS
 */
function saveMissedDaysLog(log: MissedDaysLog): void {
  log.lastUpdated = Date.now();
  writeFileSync(LOCAL_MISSED_DAYS_FILE, JSON.stringify(log, null, 2));

  const gcsPath = `gs://${GCS_BUCKET}/${GCS_MISSED_DAYS_FILE}`;
  try {
    execSync(`gsutil cp "${LOCAL_MISSED_DAYS_FILE}" "${gcsPath}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    console.error(`❌ Failed to upload missed days log: ${error}`);
  }
}

/**
 * Add failed fetch to missed days log
 */
function logMissedDay(
  log: MissedDaysLog,
  ticker: string,
  exchange: string,
  date: string,
  timestamp: number,
  error: string
): void {
  const existingIndex = log.failures.findIndex(
    (f) => f.ticker === ticker && f.exchange === exchange && f.date === date
  );

  if (existingIndex >= 0) {
    log.failures[existingIndex].attempts++;
    log.failures[existingIndex].lastAttempt = Date.now();
    log.failures[existingIndex].error = error;
  } else {
    log.failures.push({
      ticker,
      exchange,
      date,
      timestamp,
      error,
      attempts: 1,
      firstAttempt: Date.now(),
      lastAttempt: Date.now(),
    });
  }
}

/**
 * Backfill data for specific date
 */
async function backfillDate(
  isoDate: string,
  timestamp: number,
  tickers: string[],
  missedDaysLog: MissedDaysLog,
  dryRun: boolean
) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📅 Backfilling: ${isoDate}`);
  console.log(`${"=".repeat(60)}`);

  const rateLimiter = new ApiRateLimiter({
    maxRetries: 3,
    requestTimeout: 15000,
    backoffMultiplier: 2,
  });

  const results: Array<{
    ticker: string;
    exchange: string;
    success: boolean;
    newDataPoint: boolean;
    error?: string;
  }> = [];

  // Build list of all endpoints
  const endpoints: Array<{ ticker: string; exchange: keyof typeof EXCHANGE_MAP }> = [];
  for (const ticker of tickers) {
    for (const exchange of EXCHANGES) {
      endpoints.push({ ticker, exchange });
    }
  }

  const totalEndpoints = endpoints.length;
  console.log(`📊 Processing ${totalEndpoints} endpoints\n`);

  // Process in batches
  const batchSize = 10;
  const totalBatches = Math.ceil(endpoints.length / batchSize);

  for (let i = 0; i < endpoints.length; i += batchSize) {
    const batch = endpoints.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    console.log(`🔄 Batch ${batchNum}/${totalBatches} (${batch.length} endpoints)...`);

    const batchPromises = batch.map(async ({ ticker, exchange }) => {
      const fnarExchange = EXCHANGE_MAP[exchange];
      const url = `https://rest.fnar.net/exchange/cxpc/${ticker.toLowerCase()}.${fnarExchange}/${timestamp}`;

      const result = await rateLimiter.fetchWithRateLimit(url, ticker, exchange);

      if (!result.success) {
        const errorMsg = result.error || "Unknown error";
        logMissedDay(missedDaysLog, ticker, exchange, isoDate, timestamp, errorMsg);
        return { ticker, exchange, success: false, newDataPoint: false, error: errorMsg };
      }

      // Check if API returned data
      if (!result.data || result.data.length === 0) {
        const errorMsg = "No data returned (no trading activity)";
        logMissedDay(missedDaysLog, ticker, exchange, isoDate, timestamp, errorMsg);
        return { ticker, exchange, success: false, newDataPoint: false, error: errorMsg };
      }

      // Filter for daily data
      const dailyData = result.data.filter((d: any) => d.Interval === "DAY_ONE");

      if (dailyData.length === 0) {
        const errorMsg = "No daily data in response (no trading activity)";
        logMissedDay(missedDaysLog, ticker, exchange, isoDate, timestamp, errorMsg);
        return { ticker, exchange, success: false, newDataPoint: false, error: errorMsg };
      }

      // Download existing file from GCS
      let existingData = downloadFromGCS(ticker, fnarExchange);

      if (!existingData) {
        existingData = {
          ticker,
          exchange: fnarExchange,
          lastUpdated: Date.now(),
          data: [],
        };
      }

      // Check if this data point already exists
      const alreadyExists = existingData.data.some(
        (d) => d.DateEpochMs === timestamp
      );

      if (alreadyExists) {
        return { ticker, exchange, success: true, newDataPoint: false };
      }

      // Append new data point(s)
      for (const dataPoint of dailyData) {
        if (dataPoint.DateEpochMs === timestamp) {
          existingData.data.push({
            DateEpochMs: dataPoint.DateEpochMs,
            Open: dataPoint.Open,
            Close: dataPoint.Close,
            High: dataPoint.High,
            Low: dataPoint.Low,
            Volume: dataPoint.Volume,
            Traded: dataPoint.Traded,
          });
        }
      }

      // Sort data by date
      existingData.data.sort((a, b) => a.DateEpochMs - b.DateEpochMs);
      existingData.lastUpdated = Date.now();

      // Save locally
      const filename = `${ticker}-${fnarExchange}.json`;
      const localPath = `${LOCAL_DATA_DIR}/${filename}`;
      writeFileSync(localPath, JSON.stringify(existingData, null, 2));

      // Upload to GCS (unless dry run)
      if (!dryRun) {
        const uploaded = uploadToGCS(ticker, fnarExchange);
        if (!uploaded) {
          const errorMsg = "Failed to upload to GCS";
          logMissedDay(missedDaysLog, ticker, exchange, isoDate, timestamp, errorMsg);
          return { ticker, exchange, success: false, newDataPoint: true, error: errorMsg };
        }
      }

      return { ticker, exchange, success: true, newDataPoint: true };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Progress update
    const completed = i + batch.length;
    const percent = ((completed / endpoints.length) * 100).toFixed(1);
    console.log(`   Progress: ${completed}/${endpoints.length} (${percent}%)`);

    // Delay between batches
    if (i + batchSize < endpoints.length) {
      await sleep(1000);
    }
  }

  // Print summary for this date
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const newDataPoints = results.filter((r) => r.newDataPoint).length;
  const skipped = results.filter((r) => r.success && !r.newDataPoint).length;

  console.log(`\n📊 Summary for ${isoDate}:`);
  console.log(`   ✅ Successful: ${successful}`);
  console.log(`   ❌ Failed (no trading): ${failed}`);
  console.log(`   📥 New data points: ${newDataPoints}`);
  console.log(`   ⏭️  Already had data: ${skipped}`);

  return { successful, failed, newDataPoints, skipped };
}

/**
 * Main backfill function
 */
async function backfillSpecificDates(dates: string[], dryRun: boolean = false) {
  console.log("\n🔄 Historical Price Data Backfill");
  console.log("=".repeat(60));
  console.log(`📅 Dates to backfill: ${dates.join(", ")}`);
  console.log(`🔧 Dry run: ${dryRun ? "YES" : "NO"}`);
  console.log();

  // Create local directory
  mkdirSync(LOCAL_DATA_DIR, { recursive: true });

  // Load tickers
  const tickers = loadTickersFromFile("scripts/config/tickers.txt");
  console.log(`📊 Tickers: ${tickers.length}`);
  console.log(`📊 Exchanges: ${EXCHANGES.length}`);
  console.log(`📊 Total endpoints per date: ${tickers.length * EXCHANGES.length}\n`);

  // Load missed days log
  const missedDaysLog = loadMissedDaysLog();
  console.log(`📋 Loaded missed days log: ${missedDaysLog.failures.length} previous failures\n`);

  const startTime = Date.now();
  const dateSummaries = [];

  // Process each date
  for (const isoDate of dates) {
    try {
      const { timestamp } = parseISODate(isoDate);
      const summary = await backfillDate(isoDate, timestamp, tickers, missedDaysLog, dryRun);
      dateSummaries.push({ date: isoDate, ...summary });
    } catch (error) {
      console.error(`\n❌ Error processing ${isoDate}: ${error}`);
      dateSummaries.push({ date: isoDate, error: String(error) });
    }
  }

  // Save missed days log
  if (!dryRun) {
    saveMissedDaysLog(missedDaysLog);
  }

  // Generate and upload manifest
  if (!dryRun) {
    console.log("\n📋 Generating historical prices manifest...");
    try {
      execSync("npm run generate-manifest", { stdio: "inherit" });
      console.log("✅ Manifest generated and uploaded successfully");
    } catch (error) {
      console.warn("⚠️  Failed to generate manifest, but continuing...");
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // Print overall summary
  console.log("\n" + "=".repeat(60));
  console.log(`✅ Backfill complete in ${duration}s`);
  console.log("=".repeat(60));

  console.log(`\n📊 Overall Summary:`);
  for (const summary of dateSummaries) {
    if ('error' in summary) {
      console.log(`\n   ${summary.date}: ❌ Error - ${summary.error}`);
    } else {
      console.log(`\n   ${summary.date}:`);
      console.log(`     ✅ Successful: ${summary.successful}`);
      console.log(`     ❌ No trading: ${summary.failed}`);
      console.log(`     📥 New points: ${summary.newDataPoints}`);
      console.log(`     ⏭️  Had data: ${summary.skipped}`);
    }
  }

  console.log(`\n   📋 Total missed days in log: ${missedDaysLog.failures.length}`);

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
const dates = args.filter(arg => arg !== "--dry-run" && !arg.startsWith("--"));

if (dates.length === 0) {
  console.error("❌ Error: No dates provided");
  console.error("\nUsage:");
  console.error("  npm run backfill-dates -- 2024-11-09 2024-11-10 2024-11-11");
  console.error("  npm run backfill-dates -- 2024-11-09 2024-11-10 2024-11-11 --dry-run");
  process.exit(1);
}

// Run the script
backfillSpecificDates(dates, dryRun).catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

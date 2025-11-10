import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { ApiRateLimiter } from "./lib/rate-limiter.js";
import type { HistoricalPriceData, MissedDaysLog, MissedDayEntry } from "../src/types";

/**
 * Daily Historical Price Data Update Script
 *
 * Fetches yesterday's price data for all tickers and appends to existing files.
 * Uses the FNAR API endpoint: /exchange/cxpc/{ticker}/{timestamp}
 *
 * Features:
 * - Fetches specific day using timestamp parameter
 * - Downloads existing files from GCS
 * - Appends new data points
 * - Tracks missed/failed fetches in GCS
 * - Retries with exponential backoff
 *
 * Usage:
 *   npm run update-daily-historical
 *   npm run update-daily-historical -- --dry-run  # Test without uploading
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
 * Calculate yesterday's timestamp at 00:00 UTC
 */
function getYesterdayTimestamp(): { timestamp: number; isoDate: string } {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);

  return {
    timestamp: yesterday.getTime(),
    isoDate: yesterday.toISOString().split("T")[0],
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
    // File might not exist yet (new ticker)
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
    // File doesn't exist yet, create new log
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
    // Update existing entry
    log.failures[existingIndex].attempts++;
    log.failures[existingIndex].lastAttempt = Date.now();
    log.failures[existingIndex].error = error;
  } else {
    // Add new entry
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
 * Main update function
 */
async function updateDailyHistoricalPrices(dryRun: boolean = false) {
  console.log("\n🔄 Daily Historical Price Data Update");
  console.log("=".repeat(60));

  const { timestamp, isoDate } = getYesterdayTimestamp();
  console.log(`📅 Target date: ${isoDate} (timestamp: ${timestamp})`);
  console.log(`🔧 Dry run: ${dryRun ? "YES" : "NO"}`);
  console.log();

  // Create local directory
  mkdirSync(LOCAL_DATA_DIR, { recursive: true });

  // Load tickers
  const tickers = loadTickersFromFile("scripts/config/tickers.txt");
  const totalEndpoints = tickers.length * EXCHANGES.length;
  console.log(`📊 Processing ${tickers.length} tickers × ${EXCHANGES.length} exchanges = ${totalEndpoints} endpoints\n`);

  // Initialize rate limiter
  const rateLimiter = new ApiRateLimiter({
    maxRetries: 3,
    requestTimeout: 15000,
    backoffMultiplier: 2,
  });

  // Load missed days log
  const missedDaysLog = loadMissedDaysLog();
  console.log(`📋 Loaded missed days log: ${missedDaysLog.failures.length} previous failures\n`);

  // Track results
  const results: Array<{
    ticker: string;
    exchange: string;
    success: boolean;
    newDataPoint: boolean;
    error?: string;
  }> = [];

  const startTime = Date.now();

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

    const batchPromises = batch.map(async ({ ticker, exchange }) => {
      const fnarExchange = EXCHANGE_MAP[exchange];
      const url = `https://rest.fnar.net/exchange/cxpc/${ticker.toLowerCase()}.${fnarExchange}/${timestamp}`;

      console.log(`   📡 Fetching ${ticker}.${exchange} for ${isoDate}...`);

      // Fetch data from API
      const result = await rateLimiter.fetchWithRateLimit(url, ticker, exchange);

      if (!result.success) {
        const errorMsg = result.error || "Unknown error";
        console.log(`   ❌ ${ticker}.${exchange}: ${errorMsg}`);

        // Log missed day
        logMissedDay(missedDaysLog, ticker, exchange, isoDate, timestamp, errorMsg);

        return { ticker, exchange, success: false, newDataPoint: false, error: errorMsg };
      }

      // Check if API returned data
      if (!result.data || result.data.length === 0) {
        console.log(`   ⚠️  ${ticker}.${exchange}: No data returned (no trading activity)`);
        return { ticker, exchange, success: true, newDataPoint: false };
      }

      // Filter for daily data
      const dailyData = result.data.filter((d: any) => d.Interval === "DAY_ONE");

      if (dailyData.length === 0) {
        console.log(`   ⚠️  ${ticker}.${exchange}: No daily data in response`);
        return { ticker, exchange, success: true, newDataPoint: false };
      }

      // Download existing file from GCS
      let existingData = downloadFromGCS(ticker, fnarExchange);

      if (!existingData) {
        // No existing file, create new one
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
        console.log(`   ✓ ${ticker}.${exchange}: Data already exists, skipping`);
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

      // Update timestamp
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

      console.log(`   ✅ ${ticker}.${exchange}: Added data point, total: ${existingData.data.length} days`);

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

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // Save missed days log
  if (!dryRun) {
    saveMissedDaysLog(missedDaysLog);
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log(`✅ Update complete in ${duration}s`);
  console.log("=".repeat(60));

  rateLimiter.printMetrics();

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const newDataPoints = results.filter((r) => r.newDataPoint).length;
  const skipped = results.filter((r) => r.success && !r.newDataPoint).length;

  console.log(`\n📊 Summary:`);
  console.log(`   Date: ${isoDate}`);
  console.log(`   Total endpoints: ${results.length}`);
  console.log(`   ✅ Successful: ${successful}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📥 New data points added: ${newDataPoints}`);
  console.log(`   ⏭️  Skipped (no new data): ${skipped}`);
  console.log(`   📋 Total missed days in log: ${missedDaysLog.failures.length}`);

  if (failed > 0) {
    console.log(`\n⚠️  Failed fetches:`);
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
updateDailyHistoricalPrices(dryRun).catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

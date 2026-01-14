import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { ApiRateLimiter } from "./lib/rate-limiter.js";
import type { HistoricalPriceData, MissedDaysLog, MissedDayEntry } from "../src/types";

/**
 * Daily Historical Price Data Update Script
 *
 * Fetches yesterday's price data for all tickers and updates existing files.
 * Uses the FNAR API endpoint: /exchange/cxpc/{ticker}/{timestamp}
 *
 * Features:
 * - Fetches data using yesterday's timestamp parameter
 * - Processes last 7 days from API response to catch corrections
 * - Downloads existing files from GCS
 * - Adds new data points and updates changed data points
 * - Tracks missed/failed fetches in GCS
 * - Retries with exponential backoff
 *
 * Data Correction Window:
 * - Checks last 7 days for updates (late-arriving trades, corrections)
 * - Updates existing data if values changed
 * - No additional API calls (data already in response)
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

// Constants
const DATA_CORRECTION_WINDOW = 7; // Check last 7 days for data corrections/updates

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
    newDataPoints: number;
    updatedDataPoints: number;
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

        return { ticker, exchange, success: false, newDataPoints: 0, updatedDataPoints: 0, error: errorMsg };
      }

      // Check if API returned data
      if (!result.data || result.data.length === 0) {
        const errorMsg = "No data returned (no trading activity)";
        console.log(`   ⚠️  ${ticker}.${exchange}: ${errorMsg}`);

        // Log as missed so we can retry for a few days
        logMissedDay(missedDaysLog, ticker, exchange, isoDate, timestamp, errorMsg);

        return { ticker, exchange, success: false, newDataPoints: 0, updatedDataPoints: 0, error: errorMsg };
      }

      // Filter for daily data
      const dailyData = result.data.filter((d: any) => d.Interval === "DAY_ONE");

      if (dailyData.length === 0) {
        const errorMsg = "No daily data in response (no trading activity)";
        console.log(`   ⚠️  ${ticker}.${exchange}: ${errorMsg}`);

        // Log as missed so we can retry for a few days
        logMissedDay(missedDaysLog, ticker, exchange, isoDate, timestamp, errorMsg);

        return { ticker, exchange, success: false, newDataPoints: 0, updatedDataPoints: 0, error: errorMsg };
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

      // Process last N days to catch corrections and late-arriving data
      const oldestTimestamp = timestamp - (DATA_CORRECTION_WINDOW - 1) * 24 * 60 * 60 * 1000;
      let newDataPoints = 0;
      let updatedDataPoints = 0;

      for (const dataPoint of dailyData) {
        // Only process data points in our correction window (last 7 days)
        if (dataPoint.DateEpochMs >= oldestTimestamp && dataPoint.DateEpochMs <= timestamp) {
          const existingIndex = existingData.data.findIndex(
            (d) => d.DateEpochMs === dataPoint.DateEpochMs
          );

          if (existingIndex >= 0) {
            // Data point exists - check if it changed
            const existing = existingData.data[existingIndex];
            const hasChanged =
              existing.Open !== dataPoint.Open ||
              existing.Close !== dataPoint.Close ||
              existing.High !== dataPoint.High ||
              existing.Low !== dataPoint.Low ||
              existing.Volume !== dataPoint.Volume ||
              existing.Traded !== dataPoint.Traded;

            if (hasChanged) {
              const dateStr = new Date(dataPoint.DateEpochMs).toISOString().split("T")[0];
              console.log(`   🔄 ${ticker}.${exchange}: Updated data for ${dateStr}`);

              existingData.data[existingIndex] = {
                DateEpochMs: dataPoint.DateEpochMs,
                Open: dataPoint.Open,
                Close: dataPoint.Close,
                High: dataPoint.High,
                Low: dataPoint.Low,
                Volume: dataPoint.Volume,
                Traded: dataPoint.Traded,
              };
              updatedDataPoints++;
            }
          } else {
            // New data point - add it
            existingData.data.push({
              DateEpochMs: dataPoint.DateEpochMs,
              Open: dataPoint.Open,
              Close: dataPoint.Close,
              High: dataPoint.High,
              Low: dataPoint.Low,
              Volume: dataPoint.Volume,
              Traded: dataPoint.Traded,
            });
            newDataPoints++;
          }
        }
      }

      // If no new or updated data, skip upload
      if (newDataPoints === 0 && updatedDataPoints === 0) {
        console.log(`   ✓ ${ticker}.${exchange}: No changes in last ${DATA_CORRECTION_WINDOW} days`);
        return { ticker, exchange, success: true, newDataPoints: 0, updatedDataPoints: 0 };
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
          return { ticker, exchange, success: false, newDataPoints: 0, updatedDataPoints: 0, error: errorMsg };
        }
      }

      const summary = [];
      if (newDataPoints > 0) summary.push(`${newDataPoints} new`);
      if (updatedDataPoints > 0) summary.push(`${updatedDataPoints} updated`);
      console.log(`   ✅ ${ticker}.${exchange}: ${summary.join(", ")} (total: ${existingData.data.length} days)`);

      return { ticker, exchange, success: true, newDataPoints, updatedDataPoints };
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

  // Generate and upload manifest
  if (!dryRun) {
    console.log("\n📋 Generating historical prices manifest...");
    try {
      execSync("npm run generate-manifest", { stdio: "inherit" });
      console.log("✅ Manifest generated and uploaded successfully");
    } catch (error) {
      console.warn("⚠️  Failed to generate manifest, but continuing...");
      console.warn("   You can manually run: npm run generate-manifest");
    }
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log(`✅ Update complete in ${duration}s`);
  console.log("=".repeat(60));

  rateLimiter.printMetrics();

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalNewDataPoints = results.reduce((sum, r) => sum + r.newDataPoints, 0);
  const totalUpdatedDataPoints = results.reduce((sum, r) => sum + r.updatedDataPoints, 0);
  const endpointsWithChanges = results.filter((r) => r.newDataPoints > 0 || r.updatedDataPoints > 0).length;
  const skipped = results.filter((r) => r.success && r.newDataPoints === 0 && r.updatedDataPoints === 0).length;

  console.log(`\n📊 Summary:`);
  console.log(`   Date: ${isoDate}`);
  console.log(`   Data correction window: Last ${DATA_CORRECTION_WINDOW} days`);
  console.log(`   Total endpoints: ${results.length}`);
  console.log(`   ✅ Successful: ${successful}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📥 New data points added: ${totalNewDataPoints}`);
  console.log(`   🔄 Data points updated: ${totalUpdatedDataPoints}`);
  console.log(`   📊 Endpoints with changes: ${endpointsWithChanges}`);
  console.log(`   ⏭️  Skipped (no changes): ${skipped}`);
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

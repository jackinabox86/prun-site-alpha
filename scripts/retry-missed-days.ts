import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { ApiRateLimiter } from "./lib/rate-limiter.js";
import type { HistoricalPriceData, MissedDaysLog, MissedDayEntry } from "../src/types";

/**
 * Retry Missed Days Script
 *
 * Attempts to re-fetch historical price data for days that failed in previous runs.
 * Only retries failures from the last 7 days.
 *
 * Features:
 * - Loads missed days log from GCS
 * - Filters for recent failures (last 7 days)
 * - Retries each missed day
 * - Removes successful retries from log
 * - Updates failure records with new attempts
 *
 * Usage:
 *   npm run retry-missed-days
 *   npm run retry-missed-days -- --dry-run
 */

// Exchange code mapping
const EXCHANGE_MAP: Record<string, string> = {
  ANT: "ai1",
  CIS: "ci1",
  ICA: "ic1",
  NCC: "nc1",
};

// GCS paths
const GCS_BUCKET = "prun-site-alpha-bucket";
const GCS_DATA_PATH = "historical-prices";
const GCS_MISSED_DAYS_FILE = "historical-prices-missed-days.json";
const LOCAL_DATA_DIR = "public/data/historical-prices";
const LOCAL_MISSED_DAYS_FILE = "public/data/historical-prices-missed-days.json";

// Retry window: 7 days
const RETRY_WINDOW_DAYS = 7;
const RETRY_WINDOW_MS = RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

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
    console.warn("⚠️  No missed days log found");
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
 * Get reverse exchange mapping
 */
function getFnarExchange(ticker: string, exchange: string): string {
  // Exchange might be stored as full name or FNAR code
  if (Object.values(EXCHANGE_MAP).includes(exchange)) {
    return exchange; // Already FNAR code
  }
  return EXCHANGE_MAP[exchange] || exchange;
}

/**
 * Main retry function
 */
async function retryMissedDays(dryRun: boolean = false) {
  console.log("\n🔄 Retrying Missed Days");
  console.log("=".repeat(60));
  console.log(`🔧 Dry run: ${dryRun ? "YES" : "NO"}\n`);

  // Create local directory
  mkdirSync(LOCAL_DATA_DIR, { recursive: true });

  // Load missed days log
  const missedDaysLog = loadMissedDaysLog();

  if (missedDaysLog.failures.length === 0) {
    console.log("✅ No missed days to retry!");
    return;
  }

  console.log(`📋 Total failures in log: ${missedDaysLog.failures.length}`);

  // Filter for recent failures (within retry window)
  const cutoffTime = Date.now() - RETRY_WINDOW_MS;
  const recentFailures = missedDaysLog.failures.filter(
    (f) => f.timestamp >= cutoffTime
  );

  console.log(`📅 Recent failures (last ${RETRY_WINDOW_DAYS} days): ${recentFailures.length}`);

  if (recentFailures.length === 0) {
    console.log(`\n✅ No recent failures to retry`);
    console.log(`   All failures are older than ${RETRY_WINDOW_DAYS} days\n`);
    return;
  }

  console.log();

  // Initialize rate limiter
  const rateLimiter = new ApiRateLimiter({
    maxRetries: 3,
    requestTimeout: 15000,
    backoffMultiplier: 2,
  });

  // Track results
  const successful: MissedDayEntry[] = [];
  const stillFailing: MissedDayEntry[] = [];

  const startTime = Date.now();

  // Process failures
  for (let i = 0; i < recentFailures.length; i++) {
    const failure = recentFailures[i];
    const { ticker, exchange, date, timestamp } = failure;

    console.log(`[${i + 1}/${recentFailures.length}] 🔄 Retrying ${ticker}.${exchange} for ${date}...`);

    const fnarExchange = getFnarExchange(ticker, exchange);
    const url = `https://rest.fnar.net/exchange/cxpc/${ticker.toLowerCase()}.${fnarExchange}/${timestamp}`;

    // Fetch data from API
    const result = await rateLimiter.fetchWithRateLimit(url, ticker, exchange);

    if (!result.success) {
      const errorMsg = result.error || "Unknown error";
      console.log(`   ❌ Still failing: ${errorMsg}`);

      // Update failure record
      failure.attempts++;
      failure.lastAttempt = Date.now();
      failure.error = errorMsg;
      stillFailing.push(failure);
      continue;
    }

    // Check if API returned data
    if (!result.data || result.data.length === 0) {
      console.log(`   ⚠️  No data returned (no trading activity)`);
      // Don't count as failure - remove from log
      successful.push(failure);
      continue;
    }

    // Filter for daily data
    const dailyData = result.data.filter((d: any) => d.Interval === "DAY_ONE");

    if (dailyData.length === 0) {
      console.log(`   ⚠️  No daily data in response`);
      successful.push(failure);
      continue;
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
      console.log(`   ✓ Data already exists in file`);
      successful.push(failure);
      continue;
    }

    // Append new data point(s)
    let addedCount = 0;
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
        addedCount++;
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
        failure.attempts++;
        failure.lastAttempt = Date.now();
        failure.error = errorMsg;
        stillFailing.push(failure);
        console.log(`   ❌ ${errorMsg}`);
        continue;
      }
    }

    console.log(`   ✅ Success! Added ${addedCount} data point(s), total: ${existingData.data.length} days`);
    successful.push(failure);

    // Small delay between requests
    if (i < recentFailures.length - 1) {
      await sleep(500);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // Update missed days log
  // Keep old failures (outside retry window) + still failing entries
  const oldFailures = missedDaysLog.failures.filter(
    (f) => f.timestamp < cutoffTime
  );
  missedDaysLog.failures = [...oldFailures, ...stillFailing];

  if (!dryRun) {
    saveMissedDaysLog(missedDaysLog);
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log(`✅ Retry complete in ${duration}s`);
  console.log("=".repeat(60));

  rateLimiter.printMetrics();

  console.log(`\n📊 Summary:`);
  console.log(`   Attempted: ${recentFailures.length}`);
  console.log(`   ✅ Successful: ${successful.length}`);
  console.log(`   ❌ Still failing: ${stillFailing.length}`);
  console.log(`   📋 Remaining in log: ${missedDaysLog.failures.length}`);

  if (stillFailing.length > 0) {
    console.log(`\n⚠️  Still failing after retry:`);
    stillFailing.slice(0, 10).forEach((f) => {
      console.log(`   - ${f.ticker}.${f.exchange} (${f.date}): ${f.error} (${f.attempts} attempts)`);
    });
    if (stillFailing.length > 10) {
      console.log(`   ... and ${stillFailing.length - 10} more`);
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
retryMissedDays(dryRun).catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

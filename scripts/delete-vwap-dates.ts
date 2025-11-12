import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";

/**
 * Delete specific dates from all VWAP JSON files in GCS
 *
 * This is useful when forward-filled data was calculated for dates where
 * real trading data might still arrive. By deleting these dates from VWAP
 * files, we ensure the next VWAP calculation will use the real data.
 *
 * Usage:
 *   npm run delete-vwap-dates -- 2024-11-09 2024-11-10 2024-11-11 2024-11-12
 *   npm run delete-vwap-dates -- 2024-11-09 2024-11-10 2024-11-11 2024-11-12 --dry-run
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
const GCS_VWAP_PATH = "historical-prices-vwap";
const LOCAL_TEMP_DIR = "public/data/temp-vwap-delete";

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
function parseISODate(isoDate: string): number {
  const date = new Date(isoDate + "T00:00:00.000Z");
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${isoDate}. Expected YYYY-MM-DD`);
  }
  return date.getTime();
}

/**
 * Download VWAP file from GCS
 */
function downloadVWAPFromGCS(ticker: string, fnarExchange: string): any | null {
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
    // File doesn't exist
    return null;
  }
}

/**
 * Upload VWAP file to GCS
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
    console.error(`   ❌ Failed to upload ${filename}: ${error}`);
    return false;
  }
}

/**
 * Delete specific dates from VWAP data
 */
function deleteDatesFromVWAP(
  vwapData: any,
  timestamps: number[]
): { originalCount: number; newCount: number; deletedCount: number } {
  const timestampSet = new Set(timestamps);
  const originalCount = vwapData.data.length;

  vwapData.data = vwapData.data.filter(
    (point: any) => !timestampSet.has(point.DateEpochMs)
  );

  const newCount = vwapData.data.length;
  const deletedCount = originalCount - newCount;

  // Update lastCalculated timestamp
  vwapData.lastCalculated = Date.now();

  // Update statistics
  if (vwapData.statistics) {
    vwapData.statistics.totalDays = newCount;
  }

  return { originalCount, newCount, deletedCount };
}

/**
 * Main deletion function
 */
async function deleteVWAPDates(dates: string[], dryRun: boolean = false) {
  console.log("\n🗑️  Delete Dates from VWAP Files");
  console.log("=".repeat(60));
  console.log(`📅 Dates to delete: ${dates.join(", ")}`);
  console.log(`🔧 Dry run: ${dryRun ? "YES" : "NO"}`);
  console.log();

  // Parse dates to timestamps
  const timestamps = dates.map(parseISODate);
  console.log(`📊 Timestamps: ${timestamps.map(ts => new Date(ts).toISOString().split('T')[0]).join(", ")}\n`);

  // Create local temp directory
  mkdirSync(LOCAL_TEMP_DIR, { recursive: true });

  // Load tickers
  const tickers = loadTickersFromFile("scripts/config/tickers.txt");
  console.log(`📊 Tickers: ${tickers.length}`);
  console.log(`📊 Exchanges: ${EXCHANGES.length}`);
  console.log(`📊 Total files to process: ${tickers.length * EXCHANGES.length}\n`);

  const startTime = Date.now();
  const results: Array<{
    ticker: string;
    exchange: string;
    success: boolean;
    deletedCount?: number;
    error?: string;
  }> = [];

  // Build list of all files
  const files: Array<{ ticker: string; exchange: keyof typeof EXCHANGE_MAP }> = [];
  for (const ticker of tickers) {
    for (const exchange of EXCHANGES) {
      files.push({ ticker, exchange });
    }
  }

  // Process in batches
  const batchSize = 20;
  const totalBatches = Math.ceil(files.length / batchSize);

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    console.log(`🔄 Batch ${batchNum}/${totalBatches} (${batch.length} files)...`);

    for (const { ticker, exchange } of batch) {
      const fnarExchange = EXCHANGE_MAP[exchange];

      try {
        // Download VWAP file
        const vwapData = downloadVWAPFromGCS(ticker, fnarExchange);

        if (!vwapData) {
          // File doesn't exist, skip
          results.push({ ticker, exchange, success: true, deletedCount: 0 });
          continue;
        }

        // Delete dates
        const { deletedCount } = deleteDatesFromVWAP(vwapData, timestamps);

        if (deletedCount === 0) {
          // No dates to delete
          results.push({ ticker, exchange, success: true, deletedCount: 0 });
          continue;
        }

        // Save modified file
        const filename = `${ticker}-${fnarExchange}-vwap.json`;
        const localPath = `${LOCAL_TEMP_DIR}/${filename}`;
        writeFileSync(localPath, JSON.stringify(vwapData, null, 2));

        // Upload to GCS (unless dry run)
        if (!dryRun) {
          const uploaded = uploadVWAPToGCS(ticker, fnarExchange);
          if (!uploaded) {
            results.push({
              ticker,
              exchange,
              success: false,
              error: "Failed to upload",
            });
            continue;
          }
        }

        results.push({ ticker, exchange, success: true, deletedCount });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({ ticker, exchange, success: false, error: errorMsg });
      }
    }

    // Progress update
    const completed = i + batch.length;
    const percent = ((completed / files.length) * 100).toFixed(1);
    console.log(`   Progress: ${completed}/${files.length} (${percent}%)`);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log(`✅ Deletion complete in ${duration}s`);
  console.log("=".repeat(60));

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const filesWithDeletes = results.filter((r) => r.success && (r.deletedCount || 0) > 0).length;
  const totalDeleted = results
    .filter((r) => r.success && r.deletedCount)
    .reduce((sum, r) => sum + (r.deletedCount || 0), 0);

  console.log(`\n📊 Summary:`);
  console.log(`   Total files processed: ${results.length}`);
  console.log(`   ✅ Successful: ${successful}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   🗑️  Files with deletions: ${filesWithDeletes}`);
  console.log(`   📉 Total data points deleted: ${totalDeleted}`);
  console.log(`   📊 Avg deleted per file: ${(totalDeleted / filesWithDeletes).toFixed(1)}`);

  if (failed > 0) {
    console.log(`\n⚠️  Failed files:`);
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

// Parse arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dates = args.filter((arg) => arg !== "--dry-run" && !arg.startsWith("--"));

if (dates.length === 0) {
  console.error("❌ Error: No dates provided");
  console.error("\nUsage:");
  console.error("  npm run delete-vwap-dates -- 2024-11-09 2024-11-10 2024-11-11 2024-11-12");
  console.error("  npm run delete-vwap-dates -- 2024-11-09 2024-11-10 2024-11-11 2024-11-12 --dry-run");
  process.exit(1);
}

// Run the script
deleteVWAPDates(dates, dryRun).catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

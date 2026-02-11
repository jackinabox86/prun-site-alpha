import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

/**
 * Production Volume Classification Script
 *
 * Compares each recipe's output rate against real 30-day average trading data
 * from VWAP files to classify market volume as extremely low / low / medium / high.
 * Produces a dynamic CSV that updates weekly.
 *
 * Usage:
 *   npm run classify-production-volume
 *   npm run classify-production-volume -- --dry-run
 *   npm run classify-production-volume -- --region ANT
 *
 * Future regions: BEN, HRT, MOR (add to REGION_CONFIGS when ready)
 */

// --- Region Configuration ---
// Each region needs: display name, FNAR exchange code, static input CSV URL, output CSV filename.
// Add future regions (BEN, HRT, MOR) here when their static CSVs and FNAR codes are available.
interface RegionConfig {
  name: string;
  fnarExchange: string;
  staticCsvUrl: string;
  outputFilename: string;
}

const GCS_BUCKET = "prun-site-alpha-bucket";
const GCS_VWAP_BASE = `https://storage.googleapis.com/${GCS_BUCKET}/historical-prices-vwap`;
const GCS_STATIC_BASE = `https://storage.googleapis.com/${GCS_BUCKET}/static`;
const GCS_DYNAMIC_PATH = "dynamic";
const LOCAL_TEMP_DIR = "tmp/volume-classification";

const REGION_CONFIGS: Record<string, RegionConfig> = {
  ANT: {
    name: "ANT",
    fnarExchange: "ai1",
    staticCsvUrl: `${GCS_STATIC_BASE}/production%20volume%20classification%20static%20-%20ANT.csv`,
    outputFilename: "production volume classification - ANT dynamic.csv",
  },
  // Future regions — uncomment and fill in FNAR codes when static CSVs are available:
  // BEN: {
  //   name: "BEN",
  //   fnarExchange: "???",
  //   staticCsvUrl: `${GCS_STATIC_BASE}/production%20volume%20classification%20static%20-%20BEN.csv`,
  //   outputFilename: "production volume classification - BEN dynamic.csv",
  // },
  // HRT: {
  //   name: "HRT",
  //   fnarExchange: "???",
  //   staticCsvUrl: `${GCS_STATIC_BASE}/production%20volume%20classification%20static%20-%20HRT.csv`,
  //   outputFilename: "production volume classification - HRT dynamic.csv",
  // },
  // MOR: {
  //   name: "MOR",
  //   fnarExchange: "???",
  //   staticCsvUrl: `${GCS_STATIC_BASE}/production%20volume%20classification%20static%20-%20MOR.csv`,
  //   outputFilename: "production volume classification - MOR dynamic.csv",
  // },
};

interface VWAPDataPoint {
  DateEpochMs: number;
  averageTraded30d: number;
  [key: string]: any;
}

interface VWAPHistoricalData {
  ticker: string;
  exchange: string;
  data: VWAPDataPoint[];
  [key: string]: any;
}

interface InputRow {
  Building: string;
  Ticker: string;
  RecipeID: string;
  "Runs P/D": string;
  Output1CNT: string;
  "Output P/D": string;
  "FullBase Output P/D": string;
  FactorAmount: string;
  [key: string]: string;
}

function classifyVolume(
  averageTraded30d: number,
  outputPerDay: number,
  fullBaseOutputPerDay: number
): string {
  if (averageTraded30d < outputPerDay) return "extremely low";
  if (averageTraded30d < fullBaseOutputPerDay) return "low";
  if (averageTraded30d < 10 * fullBaseOutputPerDay) return "medium";
  return "high";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function classifyProductionVolume(dryRun: boolean, regionName: string) {
  const regionConfig = REGION_CONFIGS[regionName];
  if (!regionConfig) {
    console.error(`❌ Unknown region: ${regionName}. Available: ${Object.keys(REGION_CONFIGS).join(", ")}`);
    process.exit(1);
  }

  console.log("\n📊 Production Volume Classification");
  console.log("=".repeat(60));
  console.log(`🌍 Region: ${regionConfig.name} (${regionConfig.fnarExchange})`);
  console.log(`🔧 Dry run: ${dryRun ? "YES" : "NO"}`);
  console.log();

  // Create temp directory
  mkdirSync(LOCAL_TEMP_DIR, { recursive: true });

  // Step 1: Fetch input CSV
  console.log("📥 Fetching static production volume CSV...");
  const csvResponse = await fetch(regionConfig.staticCsvUrl);
  if (!csvResponse.ok) {
    throw new Error(`Failed to fetch static CSV: ${csvResponse.status} ${csvResponse.statusText}`);
  }
  const csvText = await csvResponse.text();

  const rows: InputRow[] = parse(csvText, {
    columns: true,
    trim: true,
    skip_empty_lines: true,
  });
  console.log(`   Parsed ${rows.length} rows`);

  // Step 2: Deduplicate tickers
  const uniqueTickers = [...new Set(rows.map((r) => r.Ticker))];
  console.log(`   Found ${uniqueTickers.length} unique tickers\n`);

  // Step 3: Fetch VWAP data for each ticker (batched)
  console.log("📥 Fetching VWAP data...");
  const vwapMap = new Map<string, number | null>();
  const batchSize = 10;
  const totalBatches = Math.ceil(uniqueTickers.length / batchSize);

  for (let i = 0; i < uniqueTickers.length; i += batchSize) {
    const batch = uniqueTickers.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    console.log(`   Batch ${batchNum}/${totalBatches} (${batch.length} tickers)...`);

    const fetchPromises = batch.map(async (ticker) => {
      const url = `${GCS_VWAP_BASE}/${ticker}-${regionConfig.fnarExchange}-vwap.json`;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`   ⚠️  ${ticker}: No VWAP data (${response.status})`);
          vwapMap.set(ticker, null);
          return;
        }
        const vwapData: VWAPHistoricalData = await response.json();
        if (!vwapData.data || vwapData.data.length === 0) {
          console.warn(`   ⚠️  ${ticker}: Empty VWAP data array`);
          vwapMap.set(ticker, null);
          return;
        }
        const lastPoint = vwapData.data[vwapData.data.length - 1];
        vwapMap.set(ticker, lastPoint.averageTraded30d);
      } catch (error) {
        console.warn(`   ⚠️  ${ticker}: Failed to fetch VWAP - ${error}`);
        vwapMap.set(ticker, null);
      }
    });

    await Promise.all(fetchPromises);

    if (i + batchSize < uniqueTickers.length) {
      await sleep(500);
    }
  }

  // Step 4: Classify each row
  console.log("\n🏷️  Classifying production volume...");
  const outputRows = rows.map((row) => {
    const avgTraded = vwapMap.get(row.Ticker);
    const outputPerDay = parseFloat(row["Output P/D"]);
    const fullBaseOutputPerDay = parseFloat(row["FullBase Output P/D"]);

    let volume: string;
    let averageTraded30d: string;

    if (avgTraded === null || avgTraded === undefined) {
      volume = "no data";
      averageTraded30d = "";
    } else {
      volume = classifyVolume(avgTraded, outputPerDay, fullBaseOutputPerDay);
      averageTraded30d = avgTraded.toFixed(4);
    }

    return {
      ...row,
      volume,
      averageTraded30d,
    };
  });

  // Step 5: Write output CSV
  const outputCsv = stringify(outputRows, { header: true });
  const localOutputPath = `${LOCAL_TEMP_DIR}/${regionConfig.outputFilename}`;
  writeFileSync(localOutputPath, outputCsv);
  console.log(`   Wrote ${localOutputPath}`);

  // Step 6: Upload to GCS
  if (!dryRun) {
    console.log("\n📤 Uploading to GCS...");
    const gcsOutputPath = `gs://${GCS_BUCKET}/${GCS_DYNAMIC_PATH}/${regionConfig.outputFilename}`;
    try {
      execSync(
        `gsutil -h "Cache-Control:public, max-age=3600" -h "Content-Type:text/csv" cp "${localOutputPath}" "${gcsOutputPath}"`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
      );
      console.log(`   ✅ Uploaded to ${gcsOutputPath}`);
    } catch (error) {
      console.error(`   ❌ Upload failed: ${error}`);
      process.exit(1);
    }
  } else {
    console.log("\n⏭️  Skipping GCS upload (dry run)");
  }

  // Step 7: Print summary
  const counts: Record<string, number> = {
    "extremely low": 0,
    low: 0,
    medium: 0,
    high: 0,
    "no data": 0,
  };
  for (const row of outputRows) {
    counts[row.volume] = (counts[row.volume] || 0) + 1;
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 Classification Summary");
  console.log("=".repeat(60));
  console.log(`   Region: ${regionConfig.name}`);
  console.log(`   Total rows: ${outputRows.length}`);
  console.log(`   Extremely low: ${counts["extremely low"]}`);
  console.log(`   Low: ${counts.low}`);
  console.log(`   Medium: ${counts.medium}`);
  console.log(`   High: ${counts.high}`);
  console.log(`   No data: ${counts["no data"]}`);
  console.log();
}

// Parse arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const regionIndex = args.indexOf("--region");
const region = regionIndex !== -1 && args[regionIndex + 1] ? args[regionIndex + 1].toUpperCase() : "ANT";

classifyProductionVolume(dryRun, region).catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

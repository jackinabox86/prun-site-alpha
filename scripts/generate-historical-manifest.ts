import { writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { execSync } from "child_process";

/**
 * Generate manifest.json for historical prices in GCS
 *
 * This script creates a manifest file listing all historical price files
 * available in GCS, which is used by the web API to efficiently fetch data
 *
 * Usage:
 *   npm run generate-manifest
 */

const EXCHANGE_MAP: Record<string, string> = {
  ANT: "ai1",
  CIS: "ci1",
  ICA: "ic1",
  NCC: "nc1",
};

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

interface ManifestEntry {
  ticker: string;
  exchange: string;
  filename: string;
}

interface Manifest {
  generated: string;
  files: ManifestEntry[];
  tickerCount: number;
  fileCount: number;
}

async function generateManifest() {
  console.log("\n📋 Generating historical prices manifest...\n");

  const tickers = loadTickersFromFile("scripts/config/tickers.txt");
  const exchanges = Object.keys(EXCHANGE_MAP);

  const files: ManifestEntry[] = [];

  // Generate all possible ticker-exchange combinations
  for (const ticker of tickers) {
    for (const exchange of exchanges) {
      const exchangeCode = EXCHANGE_MAP[exchange];
      const filename = `${ticker}-${exchangeCode}.json`;

      files.push({
        ticker,
        exchange,
        filename,
      });
    }
  }

  const manifest: Manifest = {
    generated: new Date().toISOString(),
    files,
    tickerCount: tickers.length,
    fileCount: files.length,
  };

  // Save manifest locally
  const outputPath = "public/data/historical-prices-manifest.json";
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2));

  console.log(`✅ Manifest generated with ${files.length} files`);
  console.log(`   Tickers: ${tickers.length}`);
  console.log(`   Exchanges: ${exchanges.length}`);
  console.log(`   Output: ${outputPath}`);

  // Upload to GCS
  const gcsBucket = "prun-site-alpha-bucket";
  const gcsPath = "historical-prices/manifest.json";

  try {
    console.log(`\n📤 Uploading to gs://${gcsBucket}/${gcsPath}...`);
    execSync(
      `gcloud storage cp ${outputPath} gs://${gcsBucket}/${gcsPath} --cache-control="public, max-age=300"`,
      { stdio: "inherit" }
    );
    console.log("✅ Uploaded to GCS successfully");
  } catch (error) {
    console.error("❌ Failed to upload to GCS");
    console.error("   Run: gcloud auth login");
    console.error(`   Then: gcloud storage cp ${outputPath} gs://${gcsBucket}/${gcsPath}`);
    process.exit(1);
  }

  console.log("\n✅ Manifest generation complete!\n");
}

generateManifest().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

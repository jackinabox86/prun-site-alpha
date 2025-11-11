import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { ApiRateLimiter } from "./lib/rate-limiter.js";
import type { HistoricalPriceData } from "../src/types";

/**
 * Fetch historical price data from FNAR API
 *
 * This script fetches OHLC (Open, High, Low, Close) data for materials
 * from the FNAR exchange API and saves them locally.
 *
 * Branch-aware behavior:
 * - main branch: saves to production folder
 * - other branches: saves to test folder (test-{branch-name})
 *
 * Currently configured to fetch: RAT on AI1 (ANT exchange)
 * Can be expanded later to include more materials and exchanges.
 *
 * Usage:
 *   npm run fetch-historical
 */

// Detect current git branch with multiple fallback methods
function getCurrentBranch(): string {
  try {
    // Method 1: git rev-parse (most reliable)
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"], // Suppress stderr
    }).trim();
    if (branch && branch !== "HEAD") {
      return branch;
    }
  } catch (error) {
    // Silently continue to next method
  }

  try {
    // Method 2: git symbolic-ref (works in detached HEAD)
    const branch = execSync("git symbolic-ref --short HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (branch) {
      return branch;
    }
  } catch (error) {
    // Silently continue to next method
  }

  try {
    // Method 3: git branch --show-current (modern git)
    const branch = execSync("git branch --show-current", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (branch) {
      return branch;
    }
  } catch (error) {
    // Silently continue to next method
  }

  try {
    // Method 4: Check GITHUB_REF environment variable (GitHub Actions/Codespaces)
    if (process.env.GITHUB_REF) {
      const match = process.env.GITHUB_REF.match(/refs\/heads\/(.+)/);
      if (match && match[1]) {
        console.log(`   ℹ️  Detected branch from GITHUB_REF: ${match[1]}`);
        return match[1];
      }
    }
  } catch (error) {
    // Silently continue
  }

  try {
    // Method 5: Check CODESPACE_VSCODE_FOLDER (GitHub Codespaces specific)
    if (process.env.CODESPACE_VSCODE_FOLDER) {
      // Try to read .git/HEAD directly
      const fs = require("fs");
      const gitHead = fs.readFileSync(".git/HEAD", "utf8").trim();
      const match = gitHead.match(/ref: refs\/heads\/(.+)/);
      if (match && match[1]) {
        console.log(`   ℹ️  Detected branch from .git/HEAD: ${match[1]}`);
        return match[1];
      }
    }
  } catch (error) {
    // Silently continue
  }

  // All methods failed
  console.warn("⚠️  Could not detect git branch, defaulting to 'unknown'");
  console.warn("   This is safe - data will go to test folder, not production");
  return "unknown";
}

// Determine if running in production mode
function isProductionBranch(branch: string): boolean {
  return branch === "main";
}

// Exchange code mapping: Our codes -> FNAR API codes
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

interface FetchConfig {
  tickers: string[];
  exchanges: Array<keyof typeof EXCHANGE_MAP>;
  outputDir: string;
  gcsBucket: string;
  gcsPath: string;
  batchSize: number;
  delayMs: number;
}

// Detect current branch and set paths accordingly
const CURRENT_BRANCH = getCurrentBranch();
const IS_PRODUCTION = isProductionBranch(CURRENT_BRANCH);

// Configuration options
// Uncomment the one you want to use:

// Option 1: Single ticker for testing (default)
const CONFIG: FetchConfig = {
  tickers: ["RAT"],
  exchanges: ["ANT"], // Just one exchange for quick testing
  outputDir: IS_PRODUCTION
    ? "public/data/historical-prices"
    : `public/data/historical-prices-test`,
  gcsBucket: "prun-site-alpha-bucket",
  gcsPath: IS_PRODUCTION
    ? "historical-prices"
    : `historical-prices-test/${CURRENT_BRANCH}`,
  batchSize: 1,
  delayMs: 500,
};

// Option 2: All tickers from file × all exchanges (~1332 endpoints)
// IMPORTANT: This will take 20-25 minutes and make ~1332 API requests
// const CONFIG: FetchConfig = {
//   tickers: loadTickersFromFile("scripts/config/tickers.txt"),
//   exchanges: ["ANT", "CIS", "ICA", "NCC"], // All 4 exchanges
//   outputDir: IS_PRODUCTION
//     ? "public/data/historical-prices"
//     : `public/data/historical-prices-test`,
//   gcsBucket: "prun-site-alpha-bucket",
//   gcsPath: IS_PRODUCTION
//     ? "historical-prices"
//     : `historical-prices-test/${CURRENT_BRANCH}`,
//   batchSize: 10, // 10 concurrent requests
//   delayMs: 1000, // 1 second between batches
// };

// Future expansion configurations (commented out for now)
// const ESSENTIALS_CONFIG: FetchConfig = {
//   tickers: BASKETS.essentials,
//   exchanges: ["ANT", "CIS", "ICA", "NCC"],
//   outputDir: "public/data/historical-prices",
//   batchSize: 10,
//   delayMs: 1000,
// };

// const FULL_CONFIG: FetchConfig = {
//   tickers: getAllTickers(),
//   exchanges: ["ANT", "CIS", "ICA", "NCC"],
//   outputDir: "public/data/historical-prices",
//   batchSize: 10,
//   delayMs: 1000,
// };

async function fetchHistoricalPrices(config: FetchConfig) {
  console.log("\n🚀 Starting historical price fetch");
  console.log(`   Branch: ${CURRENT_BRANCH}`);
  console.log(`   Mode: ${IS_PRODUCTION ? "🟢 PRODUCTION" : "🟡 TEST"}`);
  console.log(`   Tickers: ${config.tickers.join(", ")}`);
  console.log(`   Exchanges: ${config.exchanges.join(", ")}`);
  console.log(`   Total endpoints: ${config.tickers.length * config.exchanges.length}`);
  console.log(`   Local output: ${config.outputDir}`);
  console.log(`   GCS path: gs://${config.gcsBucket}/${config.gcsPath}\n`);

  // Create output directory if it doesn't exist
  try {
    mkdirSync(config.outputDir, { recursive: true });
  } catch (err) {
    // Directory might already exist
  }

  const rateLimiter = new ApiRateLimiter({
    maxRetries: 3,
    requestTimeout: 15000, // 15 seconds for historical data
    backoffMultiplier: 2,
  });

  const startTime = Date.now();
  const results: Array<{ ticker: string; exchange: string; success: boolean; dataPoints?: number }> = [];

  // Build list of all endpoints to fetch
  const endpoints: Array<{ ticker: string; exchange: keyof typeof EXCHANGE_MAP }> = [];
  for (const ticker of config.tickers) {
    for (const exchange of config.exchanges) {
      endpoints.push({ ticker, exchange });
    }
  }

  // Fetch in batches
  const totalBatches = Math.ceil(endpoints.length / config.batchSize);

  for (let i = 0; i < endpoints.length; i += config.batchSize) {
    const batch = endpoints.slice(i, i + config.batchSize);
    const batchNum = Math.floor(i / config.batchSize) + 1;

    console.log(`\n🔄 Processing batch ${batchNum}/${totalBatches} (${batch.length} endpoints)...`);

    // Process batch in parallel
    const batchPromises = batch.map(async ({ ticker, exchange }) => {
      const fnarExchange = EXCHANGE_MAP[exchange];
      const url = `https://rest.fnar.net/exchange/cxpc/${ticker.toLowerCase()}.${fnarExchange}`;

      console.log(`   📡 Fetching ${ticker}.${exchange}...`);

      const result = await rateLimiter.fetchWithRateLimit(url, ticker, exchange);

      if (result.success && result.data) {
        // Save to file
        const filename = `${ticker}-${fnarExchange}.json`;
        const filepath = `${config.outputDir}/${filename}`;

        const historicalData: HistoricalPriceData = {
          ticker,
          exchange: fnarExchange,
          lastUpdated: Date.now(),
          data: result.data.filter((d: any) => d.Interval === "DAY_ONE"),
        };

        writeFileSync(filepath, JSON.stringify(historicalData, null, 2));

        console.log(`   ✅ ${ticker}.${exchange}: ${historicalData.data.length} days (${result.responseTime}ms)`);

        return { ticker, exchange, success: true, dataPoints: historicalData.data.length };
      } else {
        console.log(`   ❌ ${ticker}.${exchange}: ${result.error} (${result.responseTime}ms)`);
        return { ticker, exchange, success: false };
      }
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
  console.log(`✅ Fetch complete in ${duration}s`);
  console.log("=".repeat(60));

  rateLimiter.printMetrics();

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
    console.log(`\n⚠️  Failed fetches:`);
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

  console.log(`\n📁 Files saved locally to: ${config.outputDir}/`);
  console.log(`📤 To upload to GCS, run:`);
  console.log(`   gsutil -m cp -r ${config.outputDir}/* gs://${config.gcsBucket}/${config.gcsPath}/`);

  if (!IS_PRODUCTION) {
    console.log(`\n⚠️  TEST MODE: Data will be uploaded to test folder, not production`);
  }
  console.log();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the script
fetchHistoricalPrices(CONFIG).catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

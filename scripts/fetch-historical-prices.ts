import { writeFileSync, mkdirSync } from "fs";
import { ApiRateLimiter } from "./lib/rate-limiter.js";
import { getAllTickers, BASKETS } from "./config/materials.js";
import type { HistoricalPriceData } from "../src/types";

/**
 * Fetch historical price data from FNAR API
 *
 * This script fetches OHLC (Open, High, Low, Close) data for materials
 * from the FNAR exchange API and saves them locally.
 *
 * Usage:
 *   npm run fetch-historical           # Runs in test mode (RAT only)
 *   MODE=essentials npm run fetch-historical  # Fetch essentials basket
 *   MODE=full npm run fetch-historical        # Fetch all materials
 */

// Exchange code mapping: Our codes -> FNAR API codes
const EXCHANGE_MAP: Record<string, string> = {
  ANT: "ai1",
  CIS: "ci1",
  ICA: "ic1",
  NCC: "nc1",
};

interface FetchConfig {
  tickers: string[];
  exchanges: Array<keyof typeof EXCHANGE_MAP>;
  outputDir: string;
  batchSize: number;
  delayMs: number;
}

// Determine mode from environment variable
const MODE = process.env.MODE || "test";

// Configuration based on mode
const CONFIGS: Record<string, FetchConfig> = {
  // Test mode - just RAT on one exchange
  test: {
    tickers: ["RAT"],
    exchanges: ["ANT"],
    outputDir: "public/data/historical-prices",
    batchSize: 1,
    delayMs: 500,
  },

  // Essentials basket - high priority materials
  essentials: {
    tickers: BASKETS.essentials,
    exchanges: ["ANT", "CIS", "ICA", "NCC"],
    outputDir: "public/data/historical-prices",
    batchSize: 10,
    delayMs: 1000,
  },

  // Full mode - all materials
  full: {
    tickers: getAllTickers(),
    exchanges: ["ANT", "CIS", "ICA", "NCC"],
    outputDir: "public/data/historical-prices",
    batchSize: 10,
    delayMs: 1000,
  },
};

async function fetchHistoricalPrices(config: FetchConfig) {
  console.log("\n🚀 Starting historical price fetch");
  console.log(`   Mode: ${MODE.toUpperCase()}`);
  console.log(`   Tickers: ${config.tickers.length} (${config.tickers.slice(0, 5).join(", ")}${config.tickers.length > 5 ? "..." : ""})`);
  console.log(`   Exchanges: ${config.exchanges.join(", ")}`);
  console.log(`   Total endpoints: ${config.tickers.length * config.exchanges.length}`);
  console.log(`   Batch size: ${config.batchSize}`);
  console.log(`   Delay between batches: ${config.delayMs}ms`);
  console.log(`   Output: ${config.outputDir}\n`);

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

  console.log(`\n📁 Files saved to: ${config.outputDir}/\n`);
}

function formatDate(epochMs: number): string {
  if (!epochMs) return "N/A";
  return new Date(epochMs).toISOString().split("T")[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the script
const config = CONFIGS[MODE];

if (!config) {
  console.error(`\n❌ Invalid MODE: ${MODE}`);
  console.error(`   Valid modes: ${Object.keys(CONFIGS).join(", ")}\n`);
  process.exit(1);
}

fetchHistoricalPrices(config).catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

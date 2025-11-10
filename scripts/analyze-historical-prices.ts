import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { HistoricalPriceData } from "../src/types";

/**
 * Analyze historical price data from JSON files
 *
 * This script provides various analytics on the historical price data:
 * - Files with most/least records
 * - Traded volume and amount statistics
 * - Date range coverage
 * - Summary statistics by ticker and exchange
 *
 * Usage:
 *   npm run analyze-historical [directory]
 *   npm run analyze-historical          # uses test directory
 *   npm run analyze-historical prod     # uses production directory
 */

interface FileStats {
  filename: string;
  ticker: string;
  exchange: string;
  recordCount: number;
  dateRange: {
    start: Date;
    end: Date;
    days: number;
  };
  totalVolume: number;
  totalTraded: number;
  avgPrice: number;
  avgDailyVolume: number;
  avgDailyTraded: number;
}

interface AnalysisOptions {
  sortBy?: "records" | "volume" | "traded" | "ticker";
  limit?: number;
  ticker?: string;
  exchange?: string;
  daysRecent?: number;
}

/**
 * Load and parse all JSON files from a directory
 */
function loadHistoricalData(directory: string): FileStats[] {
  const files = readdirSync(directory).filter((f) => f.endsWith(".json"));

  console.log(`📂 Loading ${files.length} files from ${directory}...\n`);

  const stats: FileStats[] = [];

  for (const filename of files) {
    try {
      const filepath = join(directory, filename);
      const content = readFileSync(filepath, "utf8");
      const data: HistoricalPriceData = JSON.parse(content);

      if (!data.data || data.data.length === 0) {
        continue;
      }

      // Sort data by date
      const sortedData = [...data.data].sort(
        (a, b) => a.DateEpochMs - b.DateEpochMs
      );

      const dates = sortedData.map((d) => new Date(d.DateEpochMs));
      const startDate = dates[0];
      const endDate = dates[dates.length - 1];
      const daysDiff = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      const totalVolume = sortedData.reduce((sum, d) => sum + d.Volume, 0);
      const totalTraded = sortedData.reduce((sum, d) => sum + d.Traded, 0);
      const avgPrice =
        sortedData.reduce((sum, d) => sum + (d.Open + d.Close) / 2, 0) /
        sortedData.length;

      stats.push({
        filename,
        ticker: data.ticker,
        exchange: data.exchange,
        recordCount: data.data.length,
        dateRange: {
          start: startDate,
          end: endDate,
          days: daysDiff,
        },
        totalVolume,
        totalTraded,
        avgPrice,
        avgDailyVolume: totalVolume / sortedData.length,
        avgDailyTraded: totalTraded / sortedData.length,
      });
    } catch (error) {
      console.error(`❌ Error loading ${filename}:`, error);
    }
  }

  return stats;
}

/**
 * Display summary statistics
 */
function showSummary(stats: FileStats[]) {
  console.log("=" .repeat(70));
  console.log("📊 SUMMARY STATISTICS");
  console.log("=".repeat(70));

  const totalFiles = stats.length;
  const totalRecords = stats.reduce((sum, s) => sum + s.recordCount, 0);
  const avgRecordsPerFile = totalRecords / totalFiles;

  const totalVolume = stats.reduce((sum, s) => sum + s.totalVolume, 0);
  const totalTraded = stats.reduce((sum, s) => sum + s.totalTraded, 0);

  const exchanges = new Set(stats.map((s) => s.exchange));
  const tickers = new Set(stats.map((s) => s.ticker));

  console.log(`\nFiles analyzed:        ${totalFiles.toLocaleString()}`);
  console.log(`Total records:         ${totalRecords.toLocaleString()}`);
  console.log(`Avg records/file:      ${avgRecordsPerFile.toFixed(1)}`);
  console.log(`\nUnique tickers:        ${tickers.size}`);
  console.log(`Unique exchanges:      ${exchanges.size} (${Array.from(exchanges).join(", ")})`);
  console.log(`\nTotal volume traded:   ${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`Total trades:          ${totalTraded.toLocaleString()}`);

  // Find date range
  const allStartDates = stats.map((s) => s.dateRange.start);
  const allEndDates = stats.map((s) => s.dateRange.end);
  const earliestDate = new Date(Math.min(...allStartDates.map((d) => d.getTime())));
  const latestDate = new Date(Math.max(...allEndDates.map((d) => d.getTime())));

  console.log(`\nDate range:            ${earliestDate.toISOString().split("T")[0]} to ${latestDate.toISOString().split("T")[0]}`);
  console.log();
}

/**
 * Show top N files by various metrics
 */
function showTopFiles(stats: FileStats[], options: AnalysisOptions) {
  const { sortBy = "records", limit = 10 } = options;

  let sorted: FileStats[];
  let title: string;

  switch (sortBy) {
    case "volume":
      sorted = [...stats].sort((a, b) => b.totalVolume - a.totalVolume);
      title = "TOP FILES BY TOTAL VOLUME";
      break;
    case "traded":
      sorted = [...stats].sort((a, b) => b.totalTraded - a.totalTraded);
      title = "TOP FILES BY TRADE COUNT";
      break;
    case "ticker":
      sorted = [...stats].sort((a, b) => a.ticker.localeCompare(b.ticker));
      title = "FILES BY TICKER (ALPHABETICAL)";
      break;
    case "records":
    default:
      sorted = [...stats].sort((a, b) => b.recordCount - a.recordCount);
      title = "TOP FILES BY RECORD COUNT";
  }

  console.log("=".repeat(70));
  console.log(`📈 ${title}`);
  console.log("=".repeat(70));
  console.log();

  const display = sorted.slice(0, limit);

  // Table header
  console.log(
    "Ticker".padEnd(8) +
    "Exchange".padEnd(10) +
    "Records".padEnd(10) +
    "Days".padEnd(8) +
    "Total Volume".padEnd(18) +
    "Total Trades"
  );
  console.log("-".repeat(70));

  for (const stat of display) {
    console.log(
      stat.ticker.padEnd(8) +
      stat.exchange.padEnd(10) +
      stat.recordCount.toString().padEnd(10) +
      stat.dateRange.days.toString().padEnd(8) +
      stat.totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 }).padEnd(18) +
      stat.totalTraded.toLocaleString()
    );
  }
  console.log();
}

/**
 * Analyze a specific ticker across all exchanges
 */
function analyzeTickerAcrossExchanges(stats: FileStats[], ticker: string) {
  const tickerStats = stats.filter((s) => s.ticker === ticker);

  if (tickerStats.length === 0) {
    console.log(`❌ No data found for ticker: ${ticker}`);
    return;
  }

  console.log("=".repeat(70));
  console.log(`📊 ANALYSIS FOR ${ticker} ACROSS ALL EXCHANGES`);
  console.log("=".repeat(70));
  console.log();

  // Sort by exchange
  tickerStats.sort((a, b) => a.exchange.localeCompare(b.exchange));

  console.log(
    "Exchange".padEnd(12) +
    "Records".padEnd(10) +
    "Avg Price".padEnd(14) +
    "Total Volume".padEnd(18) +
    "Total Trades"
  );
  console.log("-".repeat(70));

  for (const stat of tickerStats) {
    console.log(
      stat.exchange.padEnd(12) +
      stat.recordCount.toString().padEnd(10) +
      stat.avgPrice.toFixed(2).padEnd(14) +
      stat.totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 }).padEnd(18) +
      stat.totalTraded.toLocaleString()
    );
  }

  // Totals
  const totalRecords = tickerStats.reduce((sum, s) => sum + s.recordCount, 0);
  const totalVolume = tickerStats.reduce((sum, s) => sum + s.totalVolume, 0);
  const totalTraded = tickerStats.reduce((sum, s) => sum + s.totalTraded, 0);
  const avgPrice = tickerStats.reduce((sum, s) => sum + s.avgPrice, 0) / tickerStats.length;

  console.log("-".repeat(70));
  console.log(
    "TOTAL".padEnd(12) +
    totalRecords.toString().padEnd(10) +
    avgPrice.toFixed(2).padEnd(14) +
    totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 }).padEnd(18) +
    totalTraded.toLocaleString()
  );
  console.log();
}

/**
 * Analyze recent trading activity (last N days)
 */
function analyzeRecentActivity(
  directory: string,
  stats: FileStats[],
  days: number = 30
) {
  console.log("=".repeat(70));
  console.log(`📅 RECENT ACTIVITY (LAST ${days} DAYS)`);
  console.log("=".repeat(70));
  console.log();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffMs = cutoffDate.getTime();

  const recentStats: Array<{
    ticker: string;
    exchange: string;
    recentVolume: number;
    recentTraded: number;
    recentDays: number;
  }> = [];

  for (const stat of stats) {
    try {
      const filepath = join(directory, stat.filename);
      const content = readFileSync(filepath, "utf8");
      const data: HistoricalPriceData = JSON.parse(content);

      const recentData = data.data.filter((d) => d.DateEpochMs >= cutoffMs);

      if (recentData.length > 0) {
        const recentVolume = recentData.reduce((sum, d) => sum + d.Volume, 0);
        const recentTraded = recentData.reduce((sum, d) => sum + d.Traded, 0);

        recentStats.push({
          ticker: stat.ticker,
          exchange: stat.exchange,
          recentVolume,
          recentTraded,
          recentDays: recentData.length,
        });
      }
    } catch (error) {
      // Skip files that can't be read
    }
  }

  // Sort by volume
  recentStats.sort((a, b) => b.recentVolume - a.recentVolume);

  console.log(
    "Ticker".padEnd(8) +
    "Exchange".padEnd(10) +
    "Days".padEnd(8) +
    "Volume".padEnd(18) +
    "Trades".padEnd(12) +
    "Avg Vol/Day"
  );
  console.log("-".repeat(70));

  for (const stat of recentStats.slice(0, 20)) {
    const avgVolPerDay = stat.recentVolume / stat.recentDays;
    console.log(
      stat.ticker.padEnd(8) +
      stat.exchange.padEnd(10) +
      stat.recentDays.toString().padEnd(8) +
      stat.recentVolume.toLocaleString(undefined, { maximumFractionDigits: 0 }).padEnd(18) +
      stat.recentTraded.toLocaleString().padEnd(12) +
      avgVolPerDay.toLocaleString(undefined, { maximumFractionDigits: 0 })
    );
  }
  console.log();
}

/**
 * Show files with least records (potential data issues)
 */
function showFilesWithLeastRecords(stats: FileStats[], limit: number = 10) {
  console.log("=".repeat(70));
  console.log(`⚠️  FILES WITH LEAST RECORDS (Potential Issues)`);
  console.log("=".repeat(70));
  console.log();

  const sorted = [...stats].sort((a, b) => a.recordCount - b.recordCount);
  const display = sorted.slice(0, limit);

  console.log(
    "Ticker".padEnd(8) +
    "Exchange".padEnd(10) +
    "Records".padEnd(10) +
    "Date Range"
  );
  console.log("-".repeat(70));

  for (const stat of display) {
    const dateRange = `${stat.dateRange.start.toISOString().split("T")[0]} to ${stat.dateRange.end.toISOString().split("T")[0]}`;
    console.log(
      stat.ticker.padEnd(8) +
      stat.exchange.padEnd(10) +
      stat.recordCount.toString().padEnd(10) +
      dateRange
    );
  }
  console.log();
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  // Determine directory
  let directory = "public/data/historical-prices-test";
  if (args[0] === "prod" || args[0] === "production") {
    directory = "public/data/historical-prices";
  } else if (args[0] && args[0] !== "test") {
    directory = args[0];
  }

  console.log("\n🔍 Historical Price Data Analysis");
  console.log(`📂 Directory: ${directory}\n`);

  // Load all data
  const stats = loadHistoricalData(directory);

  if (stats.length === 0) {
    console.log("❌ No valid data files found");
    process.exit(1);
  }

  // Show various analyses
  showSummary(stats);
  showTopFiles(stats, { sortBy: "records", limit: 15 });
  showTopFiles(stats, { sortBy: "volume", limit: 15 });
  showTopFiles(stats, { sortBy: "traded", limit: 15 });
  showFilesWithLeastRecords(stats, 10);
  analyzeRecentActivity(directory, stats, 30);

  // Example: Analyze specific ticker if provided
  const tickerArg = args.find((arg) => arg.startsWith("--ticker="));
  if (tickerArg) {
    const ticker = tickerArg.split("=")[1].toUpperCase();
    analyzeTickerAcrossExchanges(stats, ticker);
  }

  console.log("✅ Analysis complete!\n");
  console.log("💡 Tips:");
  console.log("   - Use --ticker=RAT to analyze a specific ticker");
  console.log("   - Use 'prod' argument to analyze production data");
  console.log("   - Modify script to customize analysis parameters\n");
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

/**
 * Calculate Volume-Weighted Average Price (VWAP) for specified tickers
 * for 1-day, 7-day, and 30-day periods looking back from January 14, 2026
 *
 * Usage: npx tsx scripts/calculate-dw-vwap.ts [ticker-exchange ...]
 * Examples:
 *   npx tsx scripts/calculate-dw-vwap.ts DW-ai1
 *   npx tsx scripts/calculate-dw-vwap.ts DW-ai1 AAR-ci1 RAT-nc1
 *   npx tsx scripts/calculate-dw-vwap.ts  (defaults to DW-ai1)
 */

interface HistoricalDataPoint {
  Interval: string;
  DateEpochMs: number;
  Open: number;
  Close: number;
  High: number;
  Low: number;
  Volume: number;
  Traded: number;
}

interface HistoricalPriceData {
  ticker: string;
  exchange: string;
  lastUpdated: number;
  data: HistoricalDataPoint[];
}

// Constants
const GCS_BASE_URL = 'https://storage.googleapis.com/prun-site-alpha-bucket/historical-prices';
const REFERENCE_DATE = new Date('2026-01-14T00:00:00Z');
const REFERENCE_EPOCH_MS = REFERENCE_DATE.getTime();
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PERIODS = [1, 7, 30];
const DEFAULT_TICKER = 'DW-ai1';

function calculateVWAP(data: HistoricalDataPoint[], periodDays: number): { vwap: number; totalVolume: number; totalTraded: number; daysIncluded: number } {
  // Calculate the start date (looking back from reference date, counting reference as day 1)
  // For 7 days: include Jan 8-14 (reference is Jan 14, so start is Jan 14 - 6 days = Jan 8)
  const startEpochMs = REFERENCE_EPOCH_MS - ((periodDays - 1) * MS_PER_DAY);

  // Filter data points within the period (start <= date <= reference)
  const periodData = data.filter(point =>
    point.DateEpochMs >= startEpochMs && point.DateEpochMs <= REFERENCE_EPOCH_MS
  );

  // Sum up volume and traded
  let totalVolume = 0;
  let totalTraded = 0;

  for (const point of periodData) {
    totalVolume += point.Volume;
    totalTraded += point.Traded;
  }

  // Calculate VWAP
  const vwap = totalTraded > 0 ? totalVolume / totalTraded : 0;

  return {
    vwap,
    totalVolume,
    totalTraded,
    daysIncluded: periodData.length
  };
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().split('T')[0];
}

async function processTickerExchange(tickerExchange: string): Promise<void> {
  const url = `${GCS_BASE_URL}/${tickerExchange}.json`;

  console.log(`Fetching data from GCS: ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    console.error(`Error: Failed to fetch data for ${tickerExchange} (${response.status})`);
    return;
  }

  const priceData: HistoricalPriceData = await response.json();

  console.log('='.repeat(60));
  console.log(`VWAP Analysis for ${tickerExchange.toUpperCase()}`);
  console.log('='.repeat(60));
  console.log(`Reference Date: ${formatDate(REFERENCE_EPOCH_MS)} (Jan 14, 2026)`);
  console.log(`Data Last Updated: ${formatDate(priceData.lastUpdated)}`);
  console.log(`Total Data Points: ${priceData.data.length}`);
  console.log('='.repeat(60));
  console.log();

  for (const period of PERIODS) {
    const result = calculateVWAP(priceData.data, period);
    // Show the actual inclusive range: first day is (reference - (period-1) days)
    const startDate = formatDate(REFERENCE_EPOCH_MS - ((period - 1) * MS_PER_DAY));

    console.log(`${period}-Day VWAP (${startDate} to ${formatDate(REFERENCE_EPOCH_MS)}):`);
    console.log(`  VWAP: ${result.vwap.toFixed(4)}`);
    console.log(`  Total Volume: ${result.totalVolume.toLocaleString()}`);
    console.log(`  Total Traded: ${result.totalTraded.toLocaleString()}`);
    console.log(`  Days with Data: ${result.daysIncluded}`);
    console.log();
  }
}

async function main() {
  // Parse command-line arguments
  const args = process.argv.slice(2);
  const tickers = args.length > 0 ? args : [DEFAULT_TICKER];

  for (const ticker of tickers) {
    await processTickerExchange(ticker);
  }
}

main();

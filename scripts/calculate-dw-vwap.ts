/**
 * Calculate Volume-Weighted Average Price (VWAP) for DW ticker on AI1 exchange
 * for 1-day, 7-day, and 30-day periods looking back from January 14, 2026
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
const GCS_URL = 'https://storage.googleapis.com/prun-site-alpha-bucket/historical-prices/DW-ai1.json';
const REFERENCE_DATE = new Date('2026-01-14T00:00:00Z');
const REFERENCE_EPOCH_MS = REFERENCE_DATE.getTime();
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PERIODS = [1, 7, 30];

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

async function main() {
  // Fetch from GCS
  console.log(`Fetching data from GCS: ${GCS_URL}`);
  const response = await fetch(GCS_URL);

  if (!response.ok) {
    console.error(`Error: Failed to fetch data from GCS (${response.status})`);
    process.exit(1);
  }

  const priceData: HistoricalPriceData = await response.json();

  console.log('='.repeat(60));
  console.log('VWAP Analysis for DW-AI1');
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

main();

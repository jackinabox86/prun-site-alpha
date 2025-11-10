import { writeFileSync, mkdirSync } from "fs";
import type { HistoricalPriceData } from "../src/types";

/**
 * Test script to verify the data structure and file writing
 * Uses mock data to simulate what the API would return
 */

// Mock data that matches FNAR API response structure
const mockApiResponse = [
  {
    "Interval": "DAY_ONE",
    "DateEpochMs": 1689984000000,
    "Open": 112,
    "Close": 113,
    "High": 114,
    "Low": 98,
    "Volume": 1283219.75,
    "Traded": 11529
  },
  {
    "Interval": "DAY_ONE",
    "DateEpochMs": 1690070400000,
    "Open": 114,
    "Close": 113,
    "High": 114,
    "Low": 98.19999694824219,
    "Volume": 553210.1875,
    "Traded": 4984
  },
  {
    "Interval": "DAY_ONE",
    "DateEpochMs": 1690156800000,
    "Open": 98.5999984741211,
    "Close": 113,
    "High": 113,
    "Low": 98,
    "Volume": 824616,
    "Traded": 7677
  }
];

function testDataStructure() {
  console.log("\n🧪 Testing historical price data structure\n");

  const ticker = "RAT";
  const exchange = "ai1";
  const outputDir = "public/data/historical-prices";

  // Create output directory
  try {
    mkdirSync(outputDir, { recursive: true });
    console.log(`✅ Created output directory: ${outputDir}`);
  } catch (err) {
    console.log(`   Directory already exists`);
  }

  // Create the data structure
  const historicalData: HistoricalPriceData = {
    ticker,
    exchange,
    lastUpdated: Date.now(),
    data: mockApiResponse.filter((d) => d.Interval === "DAY_ONE"),
  };

  // Write to file
  const filename = `${ticker}-${exchange}.json`;
  const filepath = `${outputDir}/${filename}`;

  writeFileSync(filepath, JSON.stringify(historicalData, null, 2));

  console.log(`\n✅ Successfully created test file: ${filename}`);
  console.log(`   Ticker: ${ticker}`);
  console.log(`   Exchange: ${exchange}`);
  console.log(`   Data points: ${historicalData.data.length}`);
  console.log(`   File size: ${(JSON.stringify(historicalData).length / 1024).toFixed(2)} KB`);

  // Display sample data
  console.log(`\n📊 Sample data structure:`);
  console.log(JSON.stringify(historicalData, null, 2).split('\n').slice(0, 20).join('\n'));
  console.log(`   ... (truncated)`);

  // Verify dates
  const firstDate = new Date(historicalData.data[0].DateEpochMs).toISOString().split('T')[0];
  const lastDate = new Date(historicalData.data[historicalData.data.length - 1].DateEpochMs).toISOString().split('T')[0];

  console.log(`\n📅 Date range:`);
  console.log(`   First: ${firstDate}`);
  console.log(`   Last: ${lastDate}`);

  // Calculate some metrics
  const avgVolume = historicalData.data.reduce((sum, d) => sum + d.Volume, 0) / historicalData.data.length;
  const avgClose = historicalData.data.reduce((sum, d) => sum + d.Close, 0) / historicalData.data.length;

  console.log(`\n📈 Sample metrics:`);
  console.log(`   Avg Daily Volume: ${avgVolume.toFixed(2)}`);
  console.log(`   Avg Close Price: ${avgClose.toFixed(2)}`);

  console.log(`\n✅ Data structure test complete!\n`);
  console.log(`📁 File saved to: ${filepath}\n`);
}

testDataStructure();

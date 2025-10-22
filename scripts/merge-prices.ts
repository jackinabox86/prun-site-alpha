import { writeFileSync } from "fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

// API endpoints
const FNAR_API = "https://rest.fnar.net/csv/prices";
const PRUNPLANNER_API =
  "https://api.prunplanner.org/csv/exchange?api_key=8LCSHkbQ-SLt9HLEiFwkHqjEPcehB2gz";

interface FnarRow {
  Ticker: string;
  [key: string]: any;
}

interface PrunPlannerRow {
  "TICKER.EXCHANGECODE": string;
  TICKER: string;
  EXCHANGECODE: string;
  ASK: string;
  BID: string;
  AVG: string;
  SUPPLY: string;
  DEMAND: string;
  TRADED: string;
}

// Map PrunPlanner exchange codes to CSV column names
const EXCHANGE_CODE_MAP: Record<string, string> = {
  PP7D_AI1: "A1-PP7",
  PP30D_AI1: "A1-PP30",
  PP7D_CI1: "CI1-PP7",
  PP30D_CI1: "CI1-PP30",
  PP7D_IC1: "IC1-PP7",
  PP30D_IC1: "IC1-PP30",
  PP7D_NC1: "NC1-PP7",
  PP30D_NC1: "NC1-PP30",
  PP7D_UNIVERSE: "UNV-PP7",
  PP30D_UNIVERSE: "UNV-PP30",
};

async function fetchCsvText(url: string): Promise<string> {
  console.log(`Fetching ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  return await response.text();
}

async function main() {
  console.log("Starting price data merge...\n");

  // Fetch both CSV sources
  const [fnarText, prunplannerText] = await Promise.all([
    fetchCsvText(FNAR_API),
    fetchCsvText(PRUNPLANNER_API),
  ]);

  // Parse FNAR CSV (this is our base)
  const fnarRows: FnarRow[] = parse(fnarText, {
    columns: true,
    skip_empty_lines: true,
    cast: true,
  });
  console.log(`✓ Parsed ${fnarRows.length} rows from FNAR`);

  // Parse PrunPlanner CSV
  const prunplannerRows: PrunPlannerRow[] = parse(prunplannerText, {
    columns: true,
    skip_empty_lines: true,
  });
  console.log(`✓ Parsed ${prunplannerRows.length} rows from PrunPlanner\n`);

  // Build a map of ticker -> { columnName: value } from PrunPlanner data
  const pp7pp30Map: Record<string, Record<string, number>> = {};

  for (const row of prunplannerRows) {
    const ticker = row.TICKER;
    const exchangeCode = row.EXCHANGECODE;
    const columnName = EXCHANGE_CODE_MAP[exchangeCode];

    if (!columnName) {
      // Skip exchange codes we don't care about
      continue;
    }

    // Use AVG column from PrunPlanner for PP7/PP30 values
    const value = parseFloat(row.AVG);
    if (isNaN(value) || value <= 0) {
      continue;
    }

    if (!pp7pp30Map[ticker]) {
      pp7pp30Map[ticker] = {};
    }

    pp7pp30Map[ticker][columnName] = value;
  }

  console.log(`Built PP7/PP30 data for ${Object.keys(pp7pp30Map).length} tickers\n`);

  // Merge: Add PP7/PP30 columns to each FNAR row
  const mergedRows = fnarRows.map((fnarRow) => {
    const ticker = fnarRow.Ticker;
    const pp7pp30Data = pp7pp30Map[ticker] || {};

    return {
      ...fnarRow,
      ...pp7pp30Data,
    };
  });

  // Get all unique column names across all rows to ensure consistent headers
  const allColumns = new Set<string>();
  for (const row of mergedRows) {
    Object.keys(row).forEach((col) => allColumns.add(col));
  }

  // Ensure PP7/PP30 columns exist in header even if no data
  Object.values(EXCHANGE_CODE_MAP).forEach((col) => allColumns.add(col));

  // Convert to CSV
  const outputCsv = stringify(mergedRows, {
    header: true,
    columns: Array.from(allColumns),
  });

  // Write to output file
  const outputPath = "public/data/prices-merged.csv";
  writeFileSync(outputPath, outputCsv);

  console.log(`✓ Merged CSV written to ${outputPath}`);
  console.log(`✓ Total rows: ${mergedRows.length}`);
  console.log(`✓ Total columns: ${allColumns.size}\n`);

  // Show sample of added columns
  const sampleTicker = mergedRows.find((row) => pp7pp30Map[row.Ticker]);
  if (sampleTicker) {
    console.log(`Sample merged row (${sampleTicker.Ticker}):`);
    Object.values(EXCHANGE_CODE_MAP).forEach((col) => {
      if (sampleTicker[col]) {
        console.log(`  ${col}: ${sampleTicker[col]}`);
      }
    });
  }

  console.log("\n✓ Merge complete!");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

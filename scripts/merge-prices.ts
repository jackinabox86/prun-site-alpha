import { writeFileSync } from "fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

// API endpoints
const FNAR_API = "https://rest.fnar.net/csv/prices";
const PRUNPLANNER_API =
  "https://api.prunplanner.org/data/exchanges/csv/";

interface FnarRow {
  Ticker: string;
  [key: string]: any;
}

interface PrunPlannerRow {
  ticker: string;
  exchange_code: string;
  vwap_7d: string;
  vwap_30d: string;
  [key: string]: string;
}

// Map PrunPlanner exchange codes to output column prefixes
const EXCHANGE_PREFIX_MAP: Record<string, string> = {
  AI1: "A1",
  CI1: "CI1",
  IC1: "IC1",
  NC1: "NC1",
  UNIVERSE: "UNV",
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
    const ticker = row.ticker;
    const exchangeCode = row.exchange_code;
    const prefix = EXCHANGE_PREFIX_MAP[exchangeCode];

    if (!prefix) {
      // Skip exchange codes we don't care about
      continue;
    }

    if (!pp7pp30Map[ticker]) {
      pp7pp30Map[ticker] = {};
    }

    const vwap7 = parseFloat(row.vwap_7d);
    if (!isNaN(vwap7) && vwap7 > 0) {
      pp7pp30Map[ticker][`${prefix}-PP7`] = vwap7;
    }

    const vwap30 = parseFloat(row.vwap_30d);
    if (!isNaN(vwap30) && vwap30 > 0) {
      pp7pp30Map[ticker][`${prefix}-PP30`] = vwap30;
    }
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
  for (const prefix of Object.values(EXCHANGE_PREFIX_MAP)) {
    allColumns.add(`${prefix}-PP7`);
    allColumns.add(`${prefix}-PP30`);
  }

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
    for (const prefix of Object.values(EXCHANGE_PREFIX_MAP)) {
      for (const suffix of ["PP7", "PP30"]) {
        const col = `${prefix}-${suffix}`;
        if (sampleTicker[col]) {
          console.log(`  ${col}: ${sampleTicker[col]}`);
        }
      }
    }
  }

  console.log("\n✓ Merge complete!");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

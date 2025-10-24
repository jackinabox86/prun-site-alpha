import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { writeFileSync } from "fs";

// GCS URLs - provided via environment variables
const GCS_RECIPES_URL = process.env.GCS_RECIPES_URL || "https://storage.googleapis.com/prun-site-alpha-bucket/recipes.csv";
const GCS_PRICES_URL = process.env.GCS_PRICES_URL || "https://storage.googleapis.com/prun-site-alpha-bucket/prices.csv";
const GCS_WORKFORCE_URL = process.env.GCS_WORKFORCE_URL || "https://storage.googleapis.com/prun-site-alpha-bucket/workforce-requirements.csv";
const GCS_BUILD_URL = process.env.GCS_BUILD_URL || "https://storage.googleapis.com/prun-site-alpha-bucket/build-requirements.csv";

interface RecipeRow {
  Building: string;
  Ticker: string;
  "Runs P/D": string | number;
  WfCst: string | number;
  Deprec: string | number;
  AllBuildCst: string | number;
  [key: string]: any;
}

interface WorkforceRequirement {
  Building: string;
  [key: string]: string;
}

interface BuildRequirement {
  Building: string;
  BuildingType: "PRODUCTION" | "HABITATION";
  [key: string]: string;
}

interface PriceRow {
  Ticker: string;
  "AI1-AskPrice"?: string | number;
  "CI1-AskPrice"?: string | number;
  "IC1-AskPrice"?: string | number;
  "NC1-AskPrice"?: string | number;
  [key: string]: any;
}

async function fetchCsvText(url: string): Promise<string> {
  console.log(`Fetching ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  return await response.text();
}

/**
 * Find best available price for a ticker across all exchanges
 * Priority: AI1 (Antares) > CI1 (Castillon) > IC1 (Icarus) > NC1 (Neocassildas)
 */
function findPrice(ticker: string, pricesMap: Map<string, PriceRow>): number | null {
  const priceRow = pricesMap.get(ticker);
  if (!priceRow) return null;

  const exchanges = ["AI1-AskPrice", "CI1-AskPrice", "IC1-AskPrice", "NC1-AskPrice"];

  for (const exchange of exchanges) {
    const price = Number(priceRow[exchange]);
    if (price && price > 0) {
      return price;
    }
  }

  return null;
}

/**
 * Calculate cost from material requirements
 */
function calculateMaterialCost(
  requirements: WorkforceRequirement | BuildRequirement,
  pricesMap: Map<string, PriceRow>
): number {
  let totalCost = 0;

  // Check up to 10 input slots
  for (let i = 1; i <= 10; i++) {
    const matKey = `Input${i}MAT`;
    const cntKey = `Input${i}CNT`;

    const material = requirements[matKey];
    const count = Number(requirements[cntKey]);

    if (material && count > 0) {
      const price = findPrice(material, pricesMap);
      if (price === null) {
        console.warn(`  Warning: No price found for ${material}, skipping`);
        continue;
      }
      totalCost += price * count;
    }
  }

  return totalCost;
}

async function main() {
  console.log("Starting dynamic cost calculation...\n");

  // Fetch all required CSVs
  const [recipesText, pricesText, workforceText, buildText] = await Promise.all([
    fetchCsvText(GCS_RECIPES_URL),
    fetchCsvText(GCS_PRICES_URL),
    fetchCsvText(GCS_WORKFORCE_URL),
    fetchCsvText(GCS_BUILD_URL),
  ]);

  // Parse CSVs
  const recipeRows: RecipeRow[] = parse(recipesText, {
    columns: true,
    skip_empty_lines: true,
  });
  console.log(`✓ Loaded ${recipeRows.length} recipe rows`);

  const priceRows: PriceRow[] = parse(pricesText, {
    columns: true,
    skip_empty_lines: true,
  });
  console.log(`✓ Loaded ${priceRows.length} price rows`);

  const workforceRows: WorkforceRequirement[] = parse(workforceText, {
    columns: true,
    skip_empty_lines: true,
  });
  console.log(`✓ Loaded ${workforceRows.length} workforce requirement rows`);

  const buildRows: BuildRequirement[] = parse(buildText, {
    columns: true,
    skip_empty_lines: true,
  });
  console.log(`✓ Loaded ${buildRows.length} build requirement rows\n`);

  // Build lookup maps
  const pricesMap = new Map<string, PriceRow>();
  for (const row of priceRows) {
    pricesMap.set(row.Ticker, row);
  }

  const workforceMap = new Map<string, WorkforceRequirement>();
  for (const row of workforceRows) {
    workforceMap.set(row.Building, row);
  }

  const buildMap = new Map<string, BuildRequirement>();
  for (const row of buildRows) {
    buildMap.set(row.Building, row);
  }

  console.log("Calculating dynamic costs for each recipe...\n");

  let updatedCount = 0;
  const buildingsProcessed = new Set<string>();

  // Process each recipe
  for (const recipe of recipeRows) {
    const building = recipe.Building;
    const runsPerDay = Number(recipe["Runs P/D"]) || 1;

    // Skip if we've already calculated costs for this building
    if (!buildingsProcessed.has(building)) {
      buildingsProcessed.add(building);

      // Calculate workforce cost
      let dailyWorkforceCost = 0;
      const workforceReq = workforceMap.get(building);
      if (workforceReq) {
        dailyWorkforceCost = calculateMaterialCost(workforceReq, pricesMap);
        console.log(`${building}: Daily workforce cost = ${dailyWorkforceCost.toFixed(2)}`);
      } else {
        console.log(`${building}: No workforce requirements found, using 0`);
      }

      // Calculate build cost and depreciation
      let totalBuildCost = 0;
      let dailyDepreciation = 0;
      const buildReq = buildMap.get(building);
      if (buildReq) {
        totalBuildCost = calculateMaterialCost(buildReq, pricesMap);
        console.log(`${building}: Total build cost = ${totalBuildCost.toFixed(2)}`);

        // Only production buildings depreciate (over 180 days)
        if (buildReq.BuildingType === "PRODUCTION") {
          dailyDepreciation = totalBuildCost / 180;
          console.log(`${building}: Daily depreciation = ${dailyDepreciation.toFixed(2)} (PRODUCTION)`);
        } else {
          console.log(`${building}: No depreciation (HABITATION)`);
        }
      } else {
        console.log(`${building}: No build requirements found, using 0`);
      }

      // Update all recipes for this building
      for (const r of recipeRows) {
        if (r.Building === building) {
          const runs = Number(r["Runs P/D"]) || 1;

          // WfCst = daily workforce cost ÷ runs per day (per batch)
          r.WfCst = (dailyWorkforceCost / runs).toFixed(2);

          // Deprec = daily depreciation ÷ runs per day (per batch)
          r.Deprec = (dailyDepreciation / runs).toFixed(2);

          // AllBuildCst = total build cost (NOT divided - one-time total)
          r.AllBuildCst = totalBuildCost.toFixed(2);

          updatedCount++;
        }
      }

      console.log("");
    }
  }

  console.log(`✓ Updated ${updatedCount} recipe rows across ${buildingsProcessed.size} buildings\n`);

  // Write output CSV
  const outputCsv = stringify(recipeRows, {
    header: true,
  });

  const outputPath = "public/data/recipes-dynamic.csv";
  writeFileSync(outputPath, outputCsv);

  console.log(`✓ Dynamic cost recipes written to ${outputPath}`);
  console.log(`✓ Total rows: ${recipeRows.length}\n`);

  // Show sample of updated costs
  const sampleRecipe = recipeRows[0];
  if (sampleRecipe) {
    console.log(`Sample recipe (${sampleRecipe.Ticker} in ${sampleRecipe.Building}):`);
    console.log(`  Runs P/D: ${sampleRecipe["Runs P/D"]}`);
    console.log(`  WfCst: ${sampleRecipe.WfCst}`);
    console.log(`  Deprec: ${sampleRecipe.Deprec}`);
    console.log(`  AllBuildCst: ${sampleRecipe.AllBuildCst}`);
  }

  console.log("\n✓ Dynamic cost calculation complete!");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

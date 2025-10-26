import { config } from "dotenv";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { writeFileSync } from "fs";

// Load environment variables from .env.local
config({ path: ".env.local" });

// GCS URLs - provided via environment variables (required, no fallbacks)
const GCS_RECIPES_URL = process.env.GCS_RECIPES_URL;
const GCS_PRICES_URL = process.env.GCS_PRICES_URL;
const GCS_WORKER_TYPE_COSTS_URL = process.env.GCS_WORKER_TYPE_COSTS_URL;
const GCS_PRODUCTION_WORKER_REQ_URL = process.env.GCS_PRODUCTION_WORKER_REQ_URL;
const GCS_BUILD_URL = process.env.GCS_BUILD_URL;
const GCS_HABITATION_COSTS_URL = process.env.GCS_HABITATION_COSTS_URL;
const GCS_PRODUCTION_HAB_REQ_URL = process.env.GCS_PRODUCTION_HAB_REQ_URL;

// Validate required environment variables
const requiredEnvVars = {
  GCS_RECIPES_URL,
  GCS_PRICES_URL,
  GCS_WORKER_TYPE_COSTS_URL,
  GCS_PRODUCTION_WORKER_REQ_URL,
  GCS_BUILD_URL,
  GCS_HABITATION_COSTS_URL,
  GCS_PRODUCTION_HAB_REQ_URL,
};

for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    throw new Error(`${key} environment variable is required but not set`);
  }
}

interface RecipeRow {
  Building: string;
  Ticker: string;
  "Runs P/D": string | number;
  // Exchange-specific cost columns
  "WfCst-ANT": string | number;
  "Deprec-ANT": string | number;
  "AllBuildCst-ANT": string | number;
  "WfCst-CIS": string | number;
  "Deprec-CIS": string | number;
  "AllBuildCst-CIS": string | number;
  "WfCst-ICA": string | number;
  "Deprec-ICA": string | number;
  "AllBuildCst-ICA": string | number;
  "WfCst-NCC": string | number;
  "Deprec-NCC": string | number;
  "AllBuildCst-NCC": string | number;
  "WfCst-UNV": string | number;
  "Deprec-UNV": string | number;
  "AllBuildCst-UNV": string | number;
  [key: string]: any;
}

interface WorkerTypeCost {
  WorkerType: string;
  [key: string]: string;
}

interface ProductionWorkerRequirement {
  ProductionBuilding: string;
  [key: string]: string;
}

interface BuildRequirement {
  Building: string;
  BuildingType: "PRODUCTION" | "HABITATION";
  [key: string]: string;
}

interface HabitationBuildingCost {
  HabitationType: string;
  [key: string]: string;
}

interface ProductionHabitationRequirement {
  ProductionBuilding: string;
  [key: string]: string;
}

interface PriceRow {
  Ticker: string;
  // ANT (Antares) - AI1
  "AI1-AskPrice"?: string | number;
  "AI1-BidPrice"?: string | number;
  "A1-PP7"?: string | number;
  "A1-PP30"?: string | number;
  // CIS (Castillon) - CI1
  "CI1-AskPrice"?: string | number;
  "CI1-BidPrice"?: string | number;
  "CI1-PP7"?: string | number;
  "CI1-PP30"?: string | number;
  // ICA (Icarus) - IC1
  "IC1-AskPrice"?: string | number;
  "IC1-BidPrice"?: string | number;
  "IC1-PP7"?: string | number;
  "IC1-PP30"?: string | number;
  // NCC (Neocassildas) - NC1
  "NC1-AskPrice"?: string | number;
  "NC1-BidPrice"?: string | number;
  "NC1-PP7"?: string | number;
  "NC1-PP30"?: string | number;
  // UNV (Universe)
  "UNV-AskPrice"?: string | number;
  "UNV-BidPrice"?: string | number;
  "UNV-PP7"?: string | number;
  "UNV-PP30"?: string | number;
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

type Exchange = "ANT" | "CIS" | "ICA" | "NCC" | "UNV";

/**
 * Exchange code to column prefix mapping
 */
const EXCHANGE_PREFIXES: Record<Exchange, string> = {
  ANT: "AI1",
  CIS: "CI1",
  ICA: "IC1",
  NCC: "NC1",
  UNV: "UNV"
};

/**
 * Find price for a ticker on a specific exchange
 * Always uses AskPrice for consistency (buying materials)
 */
function findPrice(ticker: string, pricesMap: Map<string, PriceRow>, exchange: Exchange): number | null {
  const priceRow = pricesMap.get(ticker);
  if (!priceRow) return null;

  const prefix = EXCHANGE_PREFIXES[exchange];
  const askPriceKey = `${prefix}-AskPrice`;
  const price = Number(priceRow[askPriceKey as keyof PriceRow]);

  return (price && price > 0) ? price : null;
}

/**
 * Calculate cost from material requirements for a specific exchange
 */
function calculateMaterialCost(
  requirements: WorkforceRequirement | BuildRequirement,
  pricesMap: Map<string, PriceRow>,
  exchange: Exchange
): number {
  let totalCost = 0;

  // Check up to 24 input slots (max across all CSV types)
  for (let i = 1; i <= 24; i++) {
    const matKey = `Input${i}MAT`;
    const cntKey = `Input${i}CNT`;

    const material = requirements[matKey];
    const count = Number(requirements[cntKey]);

    if (material && count > 0) {
      const price = findPrice(material, pricesMap, exchange);
      if (price === null) {
        console.warn(`  Warning: No ${exchange} price found for ${material}, skipping`);
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
  const [recipesText, pricesText, workerTypeCostsText, productionWorkerReqText, buildText, habitationCostsText, productionHabReqText] = await Promise.all([
    fetchCsvText(GCS_RECIPES_URL),
    fetchCsvText(GCS_PRICES_URL),
    fetchCsvText(GCS_WORKER_TYPE_COSTS_URL),
    fetchCsvText(GCS_PRODUCTION_WORKER_REQ_URL),
    fetchCsvText(GCS_BUILD_URL),
    fetchCsvText(GCS_HABITATION_COSTS_URL),
    fetchCsvText(GCS_PRODUCTION_HAB_REQ_URL),
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

  const workerTypeCostRows: WorkerTypeCost[] = parse(workerTypeCostsText, {
    columns: true,
    skip_empty_lines: true,
  });
  console.log(`✓ Loaded ${workerTypeCostRows.length} worker type cost rows`);

  const productionWorkerReqRows: ProductionWorkerRequirement[] = parse(productionWorkerReqText, {
    columns: true,
    skip_empty_lines: true,
  });
  console.log(`✓ Loaded ${productionWorkerReqRows.length} production-worker requirement rows`);

  const buildRows: BuildRequirement[] = parse(buildText, {
    columns: true,
    skip_empty_lines: true,
  });
  console.log(`✓ Loaded ${buildRows.length} build requirement rows`);

  const habitationCostRows: HabitationBuildingCost[] = parse(habitationCostsText, {
    columns: true,
    skip_empty_lines: true,
  });
  console.log(`✓ Loaded ${habitationCostRows.length} habitation building cost rows`);

  const productionHabReqRows: ProductionHabitationRequirement[] = parse(productionHabReqText, {
    columns: true,
    skip_empty_lines: true,
  });
  console.log(`✓ Loaded ${productionHabReqRows.length} production-habitation requirement rows\n`);

  // Build lookup maps
  const pricesMap = new Map<string, PriceRow>();
  for (const row of priceRows) {
    pricesMap.set(row.Ticker, row);
  }

  const workerTypeCostsMap = new Map<string, WorkerTypeCost>();
  for (const row of workerTypeCostRows) {
    workerTypeCostsMap.set(row.WorkerType, row);
  }

  const productionWorkerReqMap = new Map<string, ProductionWorkerRequirement>();
  for (const row of productionWorkerReqRows) {
    productionWorkerReqMap.set(row.ProductionBuilding, row);
  }

  // Build map can have multiple rows per building (PRODUCTION + HABITATION)
  const buildMap = new Map<string, BuildRequirement[]>();
  for (const row of buildRows) {
    if (!buildMap.has(row.Building)) {
      buildMap.set(row.Building, []);
    }
    buildMap.get(row.Building)!.push(row);
  }

  const habitationCostsMap = new Map<string, HabitationBuildingCost>();
  for (const row of habitationCostRows) {
    habitationCostsMap.set(row.HabitationType, row);
  }

  const productionHabReqMap = new Map<string, ProductionHabitationRequirement>();
  for (const row of productionHabReqRows) {
    productionHabReqMap.set(row.ProductionBuilding, row);
  }

  const EXCHANGES: Exchange[] = ["ANT", "CIS", "ICA", "NCC", "UNV"];

  // ========================================
  // STEP 1: Calculate ALL building costs per exchange
  // ========================================
  console.log("Calculating building costs for all buildings across all exchanges...\n");

  interface BuildingCostData {
    buildingType: "PRODUCTION" | "HABITATION";
    costs: Record<Exchange, number>;
  }

  const buildingCostsMap = new Map<string, BuildingCostData>();

  // Calculate production building costs
  const productionBuildings = new Set<string>();
  for (const row of buildRows) {
    if (row.BuildingType === "PRODUCTION") {
      productionBuildings.add(row.Building);
    }
  }

  for (const building of productionBuildings) {
    const buildReqs = buildMap.get(building) || [];
    const costs: Record<Exchange, number> = {
      ANT: 0, CIS: 0, ICA: 0, NCC: 0, UNV: 0
    };

    for (const exchange of EXCHANGES) {
      let totalBuildCost = 0;

      // Only sum PRODUCTION rows (ignore HABITATION rows if they exist - will be handled separately)
      for (const buildReq of buildReqs) {
        if (buildReq.BuildingType === "PRODUCTION") {
          totalBuildCost += calculateMaterialCost(buildReq, pricesMap, exchange);
        }
      }

      costs[exchange] = totalBuildCost;
    }

    buildingCostsMap.set(building, {
      buildingType: "PRODUCTION",
      costs
    });

    console.log(`Production building ${building}:`);
    for (const exchange of EXCHANGES) {
      console.log(`  ${exchange}: ${costs[exchange].toFixed(2)}`);
    }
  }

  // Calculate habitation building costs
  for (const habRow of habitationCostRows) {
    const habType = habRow.HabitationType;
    const costs: Record<Exchange, number> = {
      ANT: 0, CIS: 0, ICA: 0, NCC: 0, UNV: 0
    };

    for (const exchange of EXCHANGES) {
      costs[exchange] = calculateMaterialCost(habRow, pricesMap, exchange);
    }

    buildingCostsMap.set(habType, {
      buildingType: "HABITATION",
      costs
    });

    console.log(`Habitation building ${habType}:`);
    for (const exchange of EXCHANGES) {
      console.log(`  ${exchange}: ${costs[exchange].toFixed(2)}`);
    }
  }

  // Calculate worker type costs (daily)
  console.log("\nCalculating worker type costs (daily)...\n");

  interface WorkerTypeCostData {
    costs: Record<Exchange, number>;
  }

  const workerTypeCostsCalculatedMap = new Map<string, WorkerTypeCostData>();

  for (const workerRow of workerTypeCostRows) {
    const workerType = workerRow.WorkerType;
    const costs: Record<Exchange, number> = {
      ANT: 0, CIS: 0, ICA: 0, NCC: 0, UNV: 0
    };

    for (const exchange of EXCHANGES) {
      costs[exchange] = calculateMaterialCost(workerRow, pricesMap, exchange);
    }

    workerTypeCostsCalculatedMap.set(workerType, { costs });

    console.log(`Worker type ${workerType}:`);
    for (const exchange of EXCHANGES) {
      console.log(`  ${exchange}: ${costs[exchange].toFixed(2)}`);
    }
  }

  // Export worker-type-costs-calculated.csv
  console.log("\nExporting worker-type-costs-calculated.csv...");

  interface WorkerTypeCostCalculatedRow {
    WorkerType: string;
    "ANT-Cost": string;
    "CIS-Cost": string;
    "ICA-Cost": string;
    "NCC-Cost": string;
    "UNV-Cost": string;
  }

  const workerTypeCostCalculatedRows: WorkerTypeCostCalculatedRow[] = [];
  for (const [workerType, data] of workerTypeCostsCalculatedMap.entries()) {
    workerTypeCostCalculatedRows.push({
      WorkerType: workerType,
      "ANT-Cost": data.costs.ANT.toFixed(2),
      "CIS-Cost": data.costs.CIS.toFixed(2),
      "ICA-Cost": data.costs.ICA.toFixed(2),
      "NCC-Cost": data.costs.NCC.toFixed(2),
      "UNV-Cost": data.costs.UNV.toFixed(2),
    });
  }

  const workerTypeCostsCsv = stringify(workerTypeCostCalculatedRows, { header: true });
  const workerTypeCostsPath = "public/data/worker-type-costs-calculated.csv";
  writeFileSync(workerTypeCostsPath, workerTypeCostsCsv);
  console.log(`✓ Worker type costs exported to ${workerTypeCostsPath}\n`);

  // Export building-costs.csv
  console.log("\nExporting building-costs.csv...");

  interface BuildingCostRow {
    Building: string;
    BuildingType: string;
    "ANT-Cost": string;
    "CIS-Cost": string;
    "ICA-Cost": string;
    "NCC-Cost": string;
    "UNV-Cost": string;
  }

  const buildingCostRows: BuildingCostRow[] = [];
  for (const [building, data] of buildingCostsMap.entries()) {
    buildingCostRows.push({
      Building: building,
      BuildingType: data.buildingType,
      "ANT-Cost": data.costs.ANT.toFixed(2),
      "CIS-Cost": data.costs.CIS.toFixed(2),
      "ICA-Cost": data.costs.ICA.toFixed(2),
      "NCC-Cost": data.costs.NCC.toFixed(2),
      "UNV-Cost": data.costs.UNV.toFixed(2),
    });
  }

  const buildingCostsCsv = stringify(buildingCostRows, { header: true });
  const buildingCostsPath = "public/data/building-costs.csv";
  writeFileSync(buildingCostsPath, buildingCostsCsv);
  console.log(`✓ Building costs exported to ${buildingCostsPath}\n`);

  // ========================================
  // STEP 2: Calculate recipe costs with habitation
  // ========================================
  console.log("Calculating dynamic costs for each recipe across all exchanges...\n");

  let updatedCount = 0;
  const buildingsProcessed = new Set<string>();

  // Process each building once
  for (const recipe of recipeRows) {
    const building = recipe.Building;

    // Skip if we've already calculated costs for this building
    if (!buildingsProcessed.has(building)) {
      buildingsProcessed.add(building);
      console.log(`\n=== Processing ${building} ===`);

      const workerReq = productionWorkerReqMap.get(building);
      const productionBuildingData = buildingCostsMap.get(building);
      const habitationReq = productionHabReqMap.get(building);

      // Calculate costs for each exchange
      const costsByExchange: Record<Exchange, { wfCost: number; buildCost: number; deprec: number }> = {
        ANT: { wfCost: 0, buildCost: 0, deprec: 0 },
        CIS: { wfCost: 0, buildCost: 0, deprec: 0 },
        ICA: { wfCost: 0, buildCost: 0, deprec: 0 },
        NCC: { wfCost: 0, buildCost: 0, deprec: 0 },
        UNV: { wfCost: 0, buildCost: 0, deprec: 0 }
      };

      for (const exchange of EXCHANGES) {
        // Calculate workforce cost using worker types
        let dailyWorkforceCost = 0;
        if (workerReq) {
          const factorAmount = Number(workerReq.FactorAmount) || 1;
          let totalWorkerCost = 0;

          for (let i = 1; i <= 5; i++) {
            const workerTypeKey = `Worker${i}Type`;
            const workerQtyKey = `Worker${i}Qty`;
            const workerType = workerReq[workerTypeKey];
            const workerQty = Number(workerReq[workerQtyKey]);

            if (workerType && workerQty > 0) {
              const workerData = workerTypeCostsCalculatedMap.get(workerType);
              if (workerData) {
                const workerUnitCost = workerData.costs[exchange];
                totalWorkerCost += workerUnitCost * workerQty;
              } else {
                console.warn(`  Warning: Worker type ${workerType} not found in worker costs map`);
              }
            }
          }

          // Divide by FactorAmount to get per-building worker cost
          dailyWorkforceCost = totalWorkerCost / factorAmount;
        }

        // Calculate build cost and depreciation
        // Build cost = production building cost + habitation costs (from calculated map)
        // Depreciation = only production building cost / 180 days
        let productionBuildCost = 0;
        let habitationBuildCost = 0;
        let totalBuildCost = 0;
        let dailyDepreciation = 0;

        // Get production building cost from pre-calculated map
        if (productionBuildingData) {
          productionBuildCost = productionBuildingData.costs[exchange];
        }

        // Calculate habitation cost by summing required habitation buildings
        // Then divide by FactorAmount to get the per-building habitation cost
        if (habitationReq) {
          const factorAmount = Number(habitationReq.FactorAmount) || 1;

          for (let i = 1; i <= 11; i++) {
            const habTypeKey = `Hab${i}Type`;
            const habQtyKey = `Hab${i}Qty`;
            const habType = habitationReq[habTypeKey];
            const habQty = Number(habitationReq[habQtyKey]);

            if (habType && habQty > 0) {
              const habData = buildingCostsMap.get(habType);
              if (habData) {
                const habUnitCost = habData.costs[exchange];
                habitationBuildCost += habUnitCost * habQty;
              } else {
                console.warn(`  Warning: Habitation type ${habType} not found in building costs map`);
              }
            }
          }

          // Divide by FactorAmount to get per-building habitation cost
          habitationBuildCost = habitationBuildCost / factorAmount;
        }

        totalBuildCost = productionBuildCost + habitationBuildCost;

        // Depreciation is only on production building portion
        if (productionBuildCost > 0) {
          dailyDepreciation = productionBuildCost / 180;
        }

        costsByExchange[exchange] = {
          wfCost: dailyWorkforceCost,
          buildCost: totalBuildCost,
          deprec: dailyDepreciation
        };

        console.log(`  ${exchange}: WF=${dailyWorkforceCost.toFixed(2)}, Build=${totalBuildCost.toFixed(2)} (Prod=${productionBuildCost.toFixed(2)}, Hab=${habitationBuildCost.toFixed(2)}), Deprec=${dailyDepreciation.toFixed(2)}`);
      }

      // Update all recipes for this building with exchange-specific costs
      for (const r of recipeRows) {
        if (r.Building === building) {
          const runs = Number(r["Runs P/D"]) || 1;

          for (const exchange of EXCHANGES) {
            const costs = costsByExchange[exchange];

            // WfCst = daily workforce cost ÷ runs per day (per batch)
            r[`WfCst-${exchange}`] = (costs.wfCost / runs).toFixed(2);

            // Deprec = daily depreciation ÷ runs per day (per batch)
            r[`Deprec-${exchange}`] = (costs.deprec / runs).toFixed(2);

            // AllBuildCst = total build cost (NOT divided - one-time total)
            r[`AllBuildCst-${exchange}`] = costs.buildCost.toFixed(2);
          }

          updatedCount++;
        }
      }
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
    console.log(`\n  Exchange-specific costs:`);
    for (const exchange of EXCHANGES) {
      console.log(`    ${exchange}: WfCst=${sampleRecipe[`WfCst-${exchange}`]}, Deprec=${sampleRecipe[`Deprec-${exchange}`]}, BuildCst=${sampleRecipe[`AllBuildCst-${exchange}`]}`);
    }
  }

  console.log("\n✓ Dynamic cost calculation complete!");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

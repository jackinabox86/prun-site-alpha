import { config } from "dotenv";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { writeFileSync } from "fs";

// Load environment variables from .env.local
config({ path: ".env.local" });

// GCS URLs - base URLs from environment, expanded recipe URLs constructed
const GCS_PRICES_URL = process.env.GCS_PRICES_URL;
const GCS_WORKER_TYPE_COSTS_URL = process.env.GCS_WORKER_TYPE_COSTS_URL;
const GCS_PRODUCTION_WORKER_REQ_URL = process.env.GCS_PRODUCTION_WORKER_REQ_URL;
const GCS_BUILD_URL = process.env.GCS_BUILD_URL;
const GCS_HABITATION_COSTS_URL = process.env.GCS_HABITATION_COSTS_URL;
const GCS_PRODUCTION_HAB_REQ_URL = process.env.GCS_PRODUCTION_HAB_REQ_URL;

// Static folder base URL
const GCS_STATIC_BASE = "https://storage.googleapis.com/prun-site-alpha-bucket/static";

// Validate required environment variables
const requiredEnvVars = {
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

interface ExpandedRecipeRow {
  Industry: string;
  Planet: string;
  Building: string;
  Ticker: string;
  RecipeID: string;
  "Runs P/D": string | number;
  Area: string | number;
  AreaPerOutput: string | number;
  // Outputs
  Output1CNT?: string | number;
  Output1MAT?: string;
  Output2CNT?: string | number;
  Output2MAT?: string;
  Output3CNT?: string | number;
  Output3MAT?: string;
  // Inputs (10 slots)
  Input1CNT?: string | number;
  Input1MAT?: string;
  Input2CNT?: string | number;
  Input2MAT?: string;
  Input3CNT?: string | number;
  Input3MAT?: string;
  Input4CNT?: string | number;
  Input4MAT?: string;
  Input5CNT?: string | number;
  Input5MAT?: string;
  Input6CNT?: string | number;
  Input6MAT?: string;
  Input7CNT?: string | number;
  Input7MAT?: string;
  Input8CNT?: string | number;
  Input8MAT?: string;
  Input9CNT?: string | number;
  Input9MAT?: string;
  Input10CNT?: string | number;
  Input10MAT?: string;
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
  "WfCst-UNV7": string | number;
  "Deprec-UNV7": string | number;
  "AllBuildCst-UNV7": string | number;
  "WfCst-UNV30": string | number;
  "Deprec-UNV30": string | number;
  "AllBuildCst-UNV30": string | number;
  [key: string]: any;
}

interface ExtractionPlanetRow {
  Planet: string;
  MCG: string; // Y or N
  AEF: string; // Y or N
  SEA: string; // Y or N
  HSE: string; // Y or N
  INS: string; // Y or N
  TSH: string; // Y or N
  MGC: string; // Y or N
  BL: string;  // Y or N
  [key: string]: string;
}

interface PlanetConditionsRow {
  [key: string]: string | number;
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
  "AI1-AskPrice"?: string | number;
  "AI1-BidPrice"?: string | number;
  "CI1-AskPrice"?: string | number;
  "CI1-BidPrice"?: string | number;
  "IC1-AskPrice"?: string | number;
  "IC1-BidPrice"?: string | number;
  "NC1-AskPrice"?: string | number;
  "NC1-BidPrice"?: string | number;
  "UNV-AskPrice"?: string | number;
  "UNV-BidPrice"?: string | number;
  "UNV-PP7"?: string | number;
  "UNV-PP30"?: string | number;
  [key: string]: any;
}

async function fetchCsvText(url: string): Promise<string | null> {
  console.log(`Fetching ${url}...`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`  Warning: Failed to fetch ${url}: ${response.statusText}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.warn(`  Warning: Error fetching ${url}:`, error);
    return null;
  }
}

type Exchange = "ANT" | "CIS" | "ICA" | "NCC" | "UNV";

const EXCHANGE_PREFIXES: Record<Exchange, string> = {
  ANT: "AI1",
  CIS: "CI1",
  ICA: "IC1",
  NCC: "NC1",
  UNV: "UNV"
};

type PriceType = "ask" | "bid" | "pp7" | "pp30";

/**
 * Find price for a ticker on a specific exchange
 */
function findPrice(
  ticker: string,
  pricesMap: Map<string, PriceRow>,
  exchange: Exchange,
  priceType: PriceType = "ask"
): number | null {
  const priceRow = pricesMap.get(ticker);
  if (!priceRow) return null;

  const prefix = EXCHANGE_PREFIXES[exchange];

  let priceKey: string;
  if (exchange === "UNV") {
    priceKey = priceType === "pp7" ? `${prefix}-PP7` : `${prefix}-PP30`;
  } else {
    priceKey = `${prefix}-${priceType === "ask" ? "AskPrice" : "BidPrice"}`;
  }

  const price = Number(priceRow[priceKey as keyof PriceRow]);

  return (price && price > 0) ? price : null;
}

/**
 * Calculate cost from material requirements for a specific exchange
 */
function calculateMaterialCost(
  requirements: WorkerTypeCost | BuildRequirement | HabitationBuildingCost,
  pricesMap: Map<string, PriceRow>,
  exchange: Exchange,
  priceType: PriceType = "ask"
): number {
  let totalCost = 0;

  // Check up to 24 input slots
  for (let i = 1; i <= 24; i++) {
    const matKey = `Input${i}MAT`;
    const cntKey = `Input${i}CNT`;

    const material = requirements[matKey];
    const count = Number(requirements[cntKey]);

    if (material && count > 0) {
      const price = findPrice(material, pricesMap, exchange, priceType);
      if (price === null) {
        const priceTypeLabel = exchange === "UNV"
          ? priceType.toUpperCase()
          : priceType === "ask" ? "AskPrice" : "BidPrice";
        console.warn(`  Warning: No ${exchange} ${priceTypeLabel} price found for ${material}, skipping`);
        continue;
      }
      totalCost += price * count;
    }
  }

  return totalCost;
}

async function main() {
  console.log("Starting expanded recipe cost calculation...\n");

  // List of exchanges to process (extendable for future)
  const EXCHANGES_TO_PROCESS: Exchange[] = ["ANT"];

  // Fetch common data files
  console.log("Fetching common data files...");
  const [pricesText, workerTypeCostsText, productionWorkerReqText, buildText, habitationCostsText, productionHabReqText] = await Promise.all([
    fetchCsvText(GCS_PRICES_URL!),
    fetchCsvText(GCS_WORKER_TYPE_COSTS_URL!),
    fetchCsvText(GCS_PRODUCTION_WORKER_REQ_URL!),
    fetchCsvText(GCS_BUILD_URL!),
    fetchCsvText(GCS_HABITATION_COSTS_URL!),
    fetchCsvText(GCS_PRODUCTION_HAB_REQ_URL!),
  ]);

  if (!pricesText || !workerTypeCostsText || !productionWorkerReqText || !buildText || !habitationCostsText || !productionHabReqText) {
    throw new Error("Failed to fetch required common data files");
  }

  // Parse common CSV files
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

  // Build lookup maps for common data
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

  // Fetch planet condition files (shared across all exchanges)
  console.log("Fetching planet condition files...");
  const planetCondProdText = await fetchCsvText(`${GCS_STATIC_BASE}/planetconditionsproduction.csv`);
  const planetCondHabText = await fetchCsvText(`${GCS_STATIC_BASE}/planetconditionshabitation.csv`);

  if (!planetCondProdText || !planetCondHabText) {
    throw new Error("Failed to fetch planet condition files");
  }

  const planetCondProdRows: PlanetConditionsRow[] = parse(planetCondProdText, {
    columns: true,
    skip_empty_lines: true,
  });
  console.log(`✓ Loaded ${planetCondProdRows.length} planet conditions (production) rows`);

  const planetCondHabRows: PlanetConditionsRow[] = parse(planetCondHabText, {
    columns: true,
    skip_empty_lines: true,
  });
  console.log(`✓ Loaded ${planetCondHabRows.length} planet conditions (habitation) rows\n`);

  // Build planet conditions maps (keyed by building type: RIG, COL, EXT)
  const planetCondProdMap = new Map<string, PlanetConditionsRow>();
  for (const row of planetCondProdRows) {
    // First column is the building type (key varies, could be empty header or specific name)
    const buildingType = Object.values(row)[0] as string;
    planetCondProdMap.set(buildingType, row);
  }

  const planetCondHabMap = new Map<string, PlanetConditionsRow>();
  for (const row of planetCondHabRows) {
    const buildingType = Object.values(row)[0] as string;
    planetCondHabMap.set(buildingType, row);
  }

  type ExchangeVariant = Exchange | "UNV7" | "UNV30";
  const EXCHANGE_VARIANTS: ExchangeVariant[] = ["ANT", "CIS", "ICA", "NCC", "UNV7", "UNV30"];

  // Calculate worker type costs for all exchanges
  console.log("Calculating worker type costs (daily)...\n");

  interface WorkerTypeCostData {
    costs: Partial<Record<ExchangeVariant, number>>;
  }

  const workerTypeCostsCalculatedMap = new Map<string, WorkerTypeCostData>();

  for (const workerRow of workerTypeCostRows) {
    const workerType = workerRow.WorkerType;
    const costs: Partial<Record<ExchangeVariant, number>> = {};

    for (const variant of EXCHANGE_VARIANTS) {
      let exchange: Exchange;
      let priceType: PriceType = "ask";

      if (variant === "UNV7") {
        exchange = "UNV";
        priceType = "pp7";
      } else if (variant === "UNV30") {
        exchange = "UNV";
        priceType = "pp30";
      } else {
        exchange = variant as Exchange;
        priceType = "ask";
      }

      costs[variant] = calculateMaterialCost(workerRow, pricesMap, exchange, priceType);
    }

    workerTypeCostsCalculatedMap.set(workerType, { costs });
  }

  // Calculate building costs for all exchanges
  console.log("Calculating building costs...\n");

  interface BuildingCostData {
    buildingType: "PRODUCTION" | "HABITATION";
    costs: Partial<Record<ExchangeVariant, number>>;
  }

  const buildingCostsMap = new Map<string, BuildingCostData>();

  // Production buildings
  const productionBuildings = new Set<string>();
  for (const row of buildRows) {
    if (row.BuildingType === "PRODUCTION") {
      productionBuildings.add(row.Building);
    }
  }

  for (const building of productionBuildings) {
    const buildReqs = buildMap.get(building) || [];
    const costs: Partial<Record<ExchangeVariant, number>> = {};

    for (const variant of EXCHANGE_VARIANTS) {
      let exchange: Exchange;
      let priceType: PriceType = "ask";

      if (variant === "UNV7") {
        exchange = "UNV";
        priceType = "pp7";
      } else if (variant === "UNV30") {
        exchange = "UNV";
        priceType = "pp30";
      } else {
        exchange = variant as Exchange;
        priceType = "ask";
      }

      let totalBuildCost = 0;
      for (const buildReq of buildReqs) {
        if (buildReq.BuildingType === "PRODUCTION") {
          totalBuildCost += calculateMaterialCost(buildReq, pricesMap, exchange, priceType);
        }
      }

      costs[variant] = totalBuildCost;
    }

    buildingCostsMap.set(building, {
      buildingType: "PRODUCTION",
      costs
    });
  }

  // Habitation buildings
  for (const habRow of habitationCostRows) {
    const habType = habRow.HabitationType;
    const costs: Partial<Record<ExchangeVariant, number>> = {};

    for (const variant of EXCHANGE_VARIANTS) {
      let exchange: Exchange;
      let priceType: PriceType = "ask";

      if (variant === "UNV7") {
        exchange = "UNV";
        priceType = "pp7";
      } else if (variant === "UNV30") {
        exchange = "UNV";
        priceType = "pp30";
      } else {
        exchange = variant as Exchange;
        priceType = "ask";
      }

      costs[variant] = calculateMaterialCost(habRow, pricesMap, exchange, priceType);
    }

    buildingCostsMap.set(habType, {
      buildingType: "HABITATION",
      costs
    });
  }

  // Process each exchange's expanded recipes
  for (const exchange of EXCHANGES_TO_PROCESS) {
    console.log(`\n========================================`);
    console.log(`Processing ${exchange} expanded recipes`);
    console.log(`========================================\n`);

    // Fetch exchange-specific files
    const expandedRecipesUrl = `${GCS_STATIC_BASE}/${exchange}-expandedrecipes.csv`;
    const extractionPlanetsUrl = `${GCS_STATIC_BASE}/${exchange}-extractionplanets.csv`;

    const [expandedRecipesText, extractionPlanetsText] = await Promise.all([
      fetchCsvText(expandedRecipesUrl),
      fetchCsvText(extractionPlanetsUrl),
    ]);

    if (!expandedRecipesText) {
      console.log(`No expanded recipes found for ${exchange}, skipping...\n`);
      continue;
    }

    if (!extractionPlanetsText) {
      console.warn(`Warning: No extraction planets file found for ${exchange}, skipping...\n`);
      continue;
    }

    // Parse exchange-specific files
    const expandedRecipes: ExpandedRecipeRow[] = parse(expandedRecipesText, {
      columns: true,
      skip_empty_lines: true,
    });
    console.log(`✓ Loaded ${expandedRecipes.length} expanded recipes for ${exchange}`);

    const extractionPlanets: ExtractionPlanetRow[] = parse(extractionPlanetsText, {
      columns: true,
      skip_empty_lines: true,
    });
    console.log(`✓ Loaded ${extractionPlanets.length} extraction planets for ${exchange}\n`);

    // Build extraction planets map
    const extractionPlanetsMap = new Map<string, ExtractionPlanetRow>();
    for (const row of extractionPlanets) {
      extractionPlanetsMap.set(row.Planet, row);
    }

    // Process each recipe
    console.log(`Calculating costs for ${expandedRecipes.length} recipes...\n`);

    for (const recipe of expandedRecipes) {
      const building = recipe.Building;
      const planet = recipe.Planet;
      const runs = Number(recipe["Runs P/D"]) || 1;

      // Get planet requirements
      const planetReq = extractionPlanetsMap.get(planet);
      if (!planetReq) {
        console.warn(`  Warning: Planet ${planet} not found in extraction planets map for recipe ${recipe.RecipeID}`);
        continue;
      }

      // Get building-specific planet condition quantities
      const prodConditions = planetCondProdMap.get(building);
      const habConditions = planetCondHabMap.get(building);

      if (!prodConditions) {
        console.warn(`  Warning: No production conditions found for building ${building}`);
      }
      if (!habConditions) {
        console.warn(`  Warning: No habitation conditions found for building ${building}`);
      }

      // Calculate base costs (like calculate-dynamic-costs.ts)
      const workerReq = productionWorkerReqMap.get(building);
      const productionBuildingData = buildingCostsMap.get(building);
      const habitationReq = productionHabReqMap.get(building);

      // Determine which exchange variant to update (only ANT for now)
      const variantToUpdate = exchange as ExchangeVariant;
      const exchangeForPrices: Exchange = exchange;
      const priceTypeForExchange: PriceType = "ask"; // Use Ask prices for materials

      // Calculate workforce cost
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
              const workerUnitCost = workerData.costs[variantToUpdate] || 0;
              totalWorkerCost += workerUnitCost * workerQty;
            }
          }
        }

        dailyWorkforceCost = totalWorkerCost / factorAmount;
      }

      // Calculate base build costs
      let productionBuildCost = 0;
      let habitationBuildCost = 0;

      if (productionBuildingData) {
        productionBuildCost = productionBuildingData.costs[variantToUpdate] || 0;
      }

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
              const habUnitCost = habData.costs[variantToUpdate] || 0;
              habitationBuildCost += habUnitCost * habQty;
            }
          }
        }

        habitationBuildCost = habitationBuildCost / factorAmount;
      }

      // Calculate planet-specific adjustments
      let prodAdjustment = 0;
      let habAdjustment = 0;

      // List of materials to check (excluding MCG which is handled specially)
      const materials = ["AEF", "SEA", "HSE", "INS", "TSH", "MGC", "BL"];

      // Check for MCG/AEF special case first
      const hasMCG = planetReq.MCG === "Y";
      const hasAEF = planetReq.AEF === "Y";

      if (hasAEF && !hasMCG) {
        // Subtract MCG cost, add AEF cost
        if (prodConditions) {
          const mcgQty = Number(prodConditions.MCG) || 0;
          const aefQty = Number(prodConditions.AEF) || 0;

          const mcgPrice = findPrice("MCG", pricesMap, exchangeForPrices, priceTypeForExchange) || 0;
          const aefPrice = findPrice("AEF", pricesMap, exchangeForPrices, priceTypeForExchange) || 0;

          prodAdjustment -= mcgQty * mcgPrice;
          prodAdjustment += aefQty * aefPrice;
        }

        if (habConditions) {
          const mcgQty = Number(habConditions.MCG) || 0;
          const aefQty = Number(habConditions.AEF) || 0;

          const mcgPrice = findPrice("MCG", pricesMap, exchangeForPrices, priceTypeForExchange) || 0;
          const aefPrice = findPrice("AEF", pricesMap, exchangeForPrices, priceTypeForExchange) || 0;

          habAdjustment -= mcgQty * mcgPrice;
          habAdjustment += aefQty * aefPrice;
        }
      }
      // If hasMCG and not hasAEF, no adjustment needed (MCG already in base cost)

      // Add costs for other materials with Y flag (excluding AEF if already handled)
      for (const material of materials) {
        if (material === "AEF" && hasAEF) continue; // Already handled above

        if (planetReq[material] === "Y") {
          const price = findPrice(material, pricesMap, exchangeForPrices, priceTypeForExchange);
          if (price) {
            if (prodConditions) {
              const qty = Number(prodConditions[material]) || 0;
              prodAdjustment += qty * price;
            }
            if (habConditions) {
              const qty = Number(habConditions[material]) || 0;
              habAdjustment += qty * price;
            }
          }
        }
      }

      // Apply adjustments to costs
      const adjustedProductionCost = productionBuildCost + prodAdjustment;
      const adjustedHabitationCost = habitationBuildCost + habAdjustment;
      const adjustedTotalBuildCost = adjustedProductionCost + adjustedHabitationCost;

      // Calculate adjusted depreciation (only on production portion)
      const adjustedDailyDepreciation = adjustedProductionCost > 0 ? adjustedProductionCost / 180 : 0;

      // Update recipe costs for this exchange
      recipe[`WfCst-${variantToUpdate}`] = (dailyWorkforceCost / runs).toFixed(2);
      recipe[`Deprec-${variantToUpdate}`] = (adjustedDailyDepreciation / runs).toFixed(2);
      recipe[`AllBuildCst-${variantToUpdate}`] = adjustedTotalBuildCost.toFixed(2);
    }

    // Write output CSV for this exchange
    const outputCsv = stringify(expandedRecipes, {
      header: true,
    });

    const outputPath = `public/data/${exchange}-expandedrecipes-dynamic.csv`;
    writeFileSync(outputPath, outputCsv);

    console.log(`✓ ${exchange} expanded recipes written to ${outputPath}`);
    console.log(`✓ Total recipes: ${expandedRecipes.length}\n`);

    // Show sample
    if (expandedRecipes.length > 0) {
      const sampleRecipe = expandedRecipes[0];
      console.log(`Sample recipe: ${sampleRecipe.RecipeID} on ${sampleRecipe.Planet} (${sampleRecipe.Building})`);
      console.log(`  Runs P/D: ${sampleRecipe["Runs P/D"]}`);
      console.log(`  ${exchange} costs: WfCst=${sampleRecipe[`WfCst-${exchange}`]}, Deprec=${sampleRecipe[`Deprec-${exchange}`]}, BuildCst=${sampleRecipe[`AllBuildCst-${exchange}`]}\n`);
    }
  }

  console.log("✓ Expanded recipe cost calculation complete!");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

/** ===== Price mode selector ===== */
// Legacy type for backward compatibility
export type PriceMode = "bid" | "ask" | "pp7" | "pp30";

// New split price mode types
export type Exchange = "ANT" | "CIS" | "ICA" | "NCC" | "UNV";
export type PriceType = "ask" | "bid" | "pp7" | "pp30";

/** ===== Prices ===== */
export interface ExchangePrices {
  ask: number | null;
  bid: number | null;
  pp7: number | null;
  pp30: number | null;
}

export interface PriceEntry {
  ticker: string;
  ask: number | null;
  bid: number | null;
  pp7: number | null;
  pp30: number | null;
}

export interface PricesMap {
  [ticker: string]: {
    ANT: ExchangePrices;
    CIS: ExchangePrices;
    ICA: ExchangePrices;
    NCC: ExchangePrices;
    UNV: ExchangePrices;
  };
}

/** ===== Recipes sheet typing =====
 * Row 0 is the header row (string[]).
 * Subsequent rows are data rows; each is an array of cell values from the sheet.
 */
export type RecipeRow = Array<string | number | null>;
export type RecipeSheet = [string[], ...RecipeRow[]];

export interface RecipeMap {
  headers: string[];                       // from row 0
  map: { [ticker: string]: RecipeRow[] };  // ticker -> list of rows
}

/** ===== Scenario graph ===== */
export interface MadeInputDetail {
  recipeId: string | null;
  ticker: string;
  details: MakeOption | null;   // recursive option (child)
  amountNeeded: number;
  scenarioName: string;
  source: "BUY" | "MAKE";
  unitCost?: number | null;          // cost per unit when BUYing
  totalCostPerBatch?: number | null; // total input cost for one parent batch
  childScenario?: string | null;     // scenario string chosen for the child (MAKE)
  childRunsPerDayRequired?: number;  // runs/day needed from child to meet parent demand
  childDemandUnitsPerDay?: number;   // units/day needed from child
}

export interface MakeOption {
  recipeId: string | null;
  ticker: string;
  scenario: string;
  building: string | null;

  baseProfit: number;
  profit: number;

  cogmPerOutput: number;
  baseProfitPerOutput: number;
  adjProfitPerOutput: number;
  valuePerOutput: number;

  selfAreaPerDay: number | null;
  fullSelfAreaPerDay: number;

  profitPerDay: number;
  baseProfitPerDay: number;

  cost: number;
  workforceCost: number;
  depreciationCost: number;

  totalOutputValue: number;
  byproductValue: number;
  totalOpportunityCost: number;

  runsPerDay: number;
  area: number;
  buildCost: number;
  output1Amount: number;

  madeInputDetails: MadeInputDetail[];
  totalProfitPA?: number; // computed later
  inputBuffer7?: number; // 7-day buffer = 7 * ((cost + workforceCost) * runsPerDay)
}

export interface ScenarioRowsResult {
  subtreeAreaPerDay: number;
  subtreeAreaNeededPerDay: number;
  subtreeProfitPerArea: number;
  subtreeBuildCost: number;
  subtreeBuildCostNeeded: number;
  subtreeInputBuffer7: number;
  subtreeInputBuffer7Needed: number;
  runsPerDayRequired: number;
  demandUnitsPerDay: number;
}

/** ===== Best recipe mapping ===== */
// Each ticker has exactly one best Scenario (string) and a chosen RecipeID.
export interface BestMapEntry {
  recipeId: string | null;
  scenario: string; // full scenario string from BestRecipeIDs
}
export type BestMap = Record<string, BestMapEntry>;

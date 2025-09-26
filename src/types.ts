/** Price modes for evaluating inputs/outputs */
export type PriceMode = "bid" | "ask";

/** One entry in the normalized prices map */
export interface PricesMap {
  [ticker: string]: {
    ask: number | null;
    bid: number | null;
  };
}

/** Optional convenience type if you ever model raw price rows */
export interface PriceEntry {
  ticker: string;
  ask: number | null;
  bid: number | null;
}

/**
 * A single data row from the Recipes sheet (NOT the header row).
 * Each row is an ordered array of cell values (strings/numbers/null),
 * aligned to the header names by index.
 */
export type RecipeRow = (string | number | null)[];

/**
 * The entire Recipes sheet as loaded from JSON:
 * - First element is the header row (array of column names)
 * - Remaining elements are RecipeRow[] data rows
 */
export type RecipeSheet = [string[], ...RecipeRow[]];

/** Indexed/normalized view of the Recipes sheet */
export interface RecipeMap {
  headers: string[];                       // header row (e.g., ["Ticker","RecipeID",...])
  map: { [ticker: string]: RecipeRow[] };  // ticker -> array of data rows for that ticker
}

/** Forward declaration for recursive structure (MakeOption below) */
export interface MadeInputDetail {
  recipeId: string | null;
  ticker: string;
  details: MakeOption | null;  // recursive link to a chosen child option
  amountNeeded: number;
  scenarioName: string;
}

/**
 * A fully expanded "make option" (one sourcing scenario) for a given ticker/recipe.
 * Mirrors your Apps Script object shape so engine logic can be ported directly.
 */
export interface MakeOption {
  recipeId: string | null;
  ticker: string;
  scenario: string;

  // Profit & cost metrics
  baseProfit: number;
  profit: number;
  cogmPerOutput: number;
  baseProfitPerOutput: number;
  adjProfitPerOutput: number;
  valuePerOutput: number;

  // Area & capacity
  selfAreaPerDay: number | null;     // area per unit (or per-output) normalized to per-day basis
  fullSelfAreaPerDay: number;        // full building area per day at capacity
  profitPerDay: number;
  baseProfitPerDay: number;

  // Breakdown costs & values
  cost: number;
  workforceCost: number;
  depreciationCost: number;
  totalOutputValue: number;
  byproductValue: number;
  totalOpportunityCost: number;

  // Recipe/run parameters
  runsPerDay: number;
  area: number;
  buildCost: number;
  output1Amount: number;

  // Children
  madeInputDetails: MadeInputDetail[];

  // Computed later during ranking
  totalProfitPA?: number;
}

/** Result from buildScenarioRows used to render rows & aggregate area/profit metrics */
export interface ScenarioRowsResult {
  rows: [string, number | string][];
  subtreeAreaPerDay: number;
  subtreeAreaNeededPerDay: number;
  subtreeProfitPerArea: number;
}

/** Best recipe lookup: Ticker -> best RecipeID */
export interface BestMap {
  [ticker: string]: string;
}

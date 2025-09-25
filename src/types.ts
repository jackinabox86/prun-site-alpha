export type PriceMode = "bid" | "ask";

export interface PriceEntry {
  ticker: string;
  ask: number | null;
  bid: number | null;
}

export interface PricesMap {
  [ticker: string]: { ask: number | null; bid: number | null };
}

export interface RecipeRow {
  [key: string]: any; // keep flexible during port
}

export interface RecipeMap {
  headers: string[];
  map: { [ticker: string]: RecipeRow[] };
}

export interface MadeInputDetail {
  recipeId: string | null;
  ticker: string;
  details: MakeOption | null;   // recursive option
  amountNeeded: number;
  scenarioName: string;
}

export interface MakeOption {
  recipeId: string | null;
  ticker: string;
  scenario: string;
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
}

export interface ScenarioRowsResult {
  rows: [string, number | string][];
  subtreeAreaPerDay: number;
  subtreeAreaNeededPerDay: number;
  subtreeProfitPerArea: number;
}

export interface BestMap {
  [ticker: string]: string; // ticker -> best RecipeID
}


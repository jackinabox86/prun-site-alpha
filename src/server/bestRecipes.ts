// src/server/bestRecipes.ts
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { findAllMakeOptions, buildScenarioRows, clearScenarioCache } from "@/core/engine";
import { findPrice } from "@/core/price";
import { CSV_URLS } from "@/lib/config";
import type { RecipeSheet, BestMap, PriceMode } from "@/types";

export interface BestRecipeResult {
  ticker: string;
  recipeId: string | null;
  scenario: string;
  profitPA: number;
  buyAllProfitPA: number | null; // Profit P/A if all inputs are bought instead of made, null if inputs missing
}

/**
 * Convert BestRecipeResult array to BestMap format
 * This allows the generated results to be used in place of the CSV-loaded bestMap
 */
export function convertToBestMap(results: BestRecipeResult[]): BestMap {
  const bestMap: BestMap = {};
  for (const result of results) {
    bestMap[result.ticker] = {
      recipeId: result.recipeId,
      scenario: result.scenario,
    };
  }
  return bestMap;
}

/**
 * Calculate buy-all profit per area for a ticker
 * This is a simple calculation where all inputs are bought (no MAKE scenarios)
 */
function calculateBuyAllProfitPA(
  ticker: string,
  recipeMap: any,
  pricesMap: any,
  priceMode: PriceMode
): number | null {
  const headers = recipeMap.headers;
  const rows = recipeMap.map[ticker] || [];
  if (!rows.length) return 0;

  const idx = {
    recipeId: headers.indexOf("RecipeID"),
    wf: headers.indexOf("WfCst"),
    dep: headers.indexOf("Deprec"),
    area: headers.indexOf("Area"),
    runs: headers.indexOf("Runs P/D"),
  };

  let bestPA = -Infinity;

  // Try each recipe for this ticker
  for (const row of rows) {
    const runsPerDay = Number(row[idx.runs] ?? 0) || 1;
    const area = Math.max(1, Number(row[idx.area] ?? 0) || 1);
    const workforceCost = Number(row[idx.wf] ?? 0) || 0;
    const depreciationCost = Number(row[idx.dep] ?? 0) || 0;

    // Calculate total input cost (buying all inputs)
    // If any input has no market price, skip this recipe entirely
    let totalInputCost = 0;
    let hasAllPrices = true;
    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Input${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Input${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const inputTicker = String(row[matIndex]);
        const inputAmount = Number(row[cntIndex] ?? 0);
        const ask = findPrice(inputTicker, pricesMap, "ask");
        if (ask == null) {
          // No market price available for this input - can't buy it
          hasAllPrices = false;
          break;
        }
        totalInputCost += inputAmount * ask;
      }
    }

    // Skip this recipe if we can't buy all inputs
    if (!hasAllPrices) continue;

    // Calculate total output value
    let totalOutputValue = 0;
    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Output${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Output${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const outTicker = String(row[matIndex]);
        const outAmount = Number(row[cntIndex] ?? 0);
        const outPrice = findPrice(outTicker, pricesMap, priceMode);
        if (outPrice) {
          totalOutputValue += outAmount * outPrice;
        }
      }
    }

    // Calculate profit per batch
    const totalCostPerBatch = totalInputCost + workforceCost + depreciationCost;
    const profitPerBatch = totalOutputValue - totalCostPerBatch;

    // Calculate profit per day and profit per area
    const profitPerDay = profitPerBatch * runsPerDay;
    const profitPA = profitPerDay / area;

    if (profitPA > bestPA) {
      bestPA = profitPA;
    }
  }

  return bestPA > -Infinity ? bestPA : null;
}

/**
 * Build dependency graph from Recipes sheet
 * Returns { graph, allTickers }
 *   graph[ticker] = list of inputs
 *   allTickers = Set of every ticker seen
 */
function buildDependencyGraph(recipeSheet: RecipeSheet): {
  graph: Record<string, string[]>;
  allTickers: Set<string>;
} {
  const headers = recipeSheet[0];
  const tickerIndex = headers.indexOf("Ticker");
  const graph: Record<string, string[]> = {};
  const allTickers = new Set<string>();

  for (let i = 1; i < recipeSheet.length; i++) {
    const row = recipeSheet[i];
    const outputTicker = row[tickerIndex];
    if (!outputTicker) continue;

    const ticker = String(outputTicker);
    allTickers.add(ticker);

    const inputs: string[] = [];
    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Input${j + 1}MAT`);
      if (matIndex !== -1 && row[matIndex]) {
        const inputTicker = String(row[matIndex]);
        inputs.push(inputTicker);
        allTickers.add(inputTicker);
      }
    }
    if (!graph[ticker]) graph[ticker] = [];
    graph[ticker].push(...inputs);
  }

  return { graph, allTickers };
}

/**
 * Compute recursive depth of a ticker in dependency graph
 * Depth = 0 for buy-only tickers
 */
function computeDepth(
  ticker: string,
  graph: Record<string, string[]>,
  memo: Record<string, number> = {}
): number {
  if (ticker in memo) return memo[ticker];
  if (!graph[ticker] || graph[ticker].length === 0) {
    memo[ticker] = 0;
    return 0;
  }
  const depths = graph[ticker].map((child) => computeDepth(child, graph, memo));
  const depth = 1 + Math.max(...depths);
  memo[ticker] = depth;
  return depth;
}

/**
 * Produce an optimal bottom-up order of tickers
 */
function getTickersInDependencyOrder(recipeSheet: RecipeSheet): string[] {
  const { graph, allTickers } = buildDependencyGraph(recipeSheet);
  const memo: Record<string, number> = {};
  const withDepth = Array.from(allTickers).map((ticker) => ({
    ticker,
    depth: computeDepth(ticker, graph, memo),
  }));
  // sort by depth ascending
  withDepth.sort((a, b) => a.depth - b.depth);
  return withDepth.map((x) => x.ticker);
}

/**
 * Refresh best recipe IDs for all tickers in dependency order
 * This is the core logic from the Apps Script refreshBestRecipeIDs function
 */
export async function refreshBestRecipeIDs(): Promise<BestRecipeResult[]> {
  // Clear caches
  clearScenarioCache();

  // Load data (no bestMap needed since we're generating it)
  const { recipeMap, pricesMap } = await loadAllFromCsv(
    { recipes: CSV_URLS.recipes, prices: CSV_URLS.prices },
    { bestMap: {} } // Pass empty bestMap since we're generating the best recipes
  );

  // Build recipe sheet for dependency analysis
  const recipeSheet: RecipeSheet = [
    recipeMap.headers,
    ...Object.values(recipeMap.map).flat(),
  ];

  // Get all tickers in bottom-up dependency order
  const orderedTickers = getTickersInDependencyOrder(recipeSheet);

  // Output buffer
  const output: BestRecipeResult[] = [];

  // Cache to store best scenarios (mimics Apps Script's setScenarioCacheForTicker)
  // This will be used by findAllMakeOptions internally via the BEST_MEMO
  const bestMapBuilding: Record<string, { recipeId: string | null; scenario: string }> = {};

  // Loop through all tickers in dependency order
  let processed = 0;
  for (const ticker of orderedTickers) {
    try {
      // Use "bid" price mode consistently (as in the original script)
      // Use exploreAllChildScenarios=false to rely on bestMapBuilding for children
      // This prevents exponential explosion while building bottom-up
      const options = findAllMakeOptions(
        ticker,
        recipeMap,
        pricesMap,
        "bid",
        bestMapBuilding, // Pass the building best map
        0,
        false, // exploreAllChildScenarios - false for performance (use cached best children)
        false // honorRecipeIdFilter
      );

      if (!options || options.length === 0) continue;

      // Compute P/A for each option
      options.forEach((option) => {
        const dailyCapacity = (option.output1Amount || 0) * (option.runsPerDay || 0);
        const result = buildScenarioRows(option, 0, dailyCapacity, false);
        option.totalProfitPA = result.subtreeProfitPerArea || 0;
      });

      // Pick best by P/A
      options.sort((a, b) => (b.totalProfitPA || 0) - (a.totalProfitPA || 0));
      const best = options[0];

      // Calculate "buy all inputs" P/A using simple helper function
      const buyAllProfitPA = calculateBuyAllProfitPA(ticker, recipeMap, pricesMap, "bid");

      // Cache normalized best (mimics setScenarioCacheForTicker)
      bestMapBuilding[ticker] = {
        recipeId: null, // Normalized as in the original script
        scenario: best.scenario || "",
      };

      // Save to output
      output.push({
        ticker,
        recipeId: best.recipeId,
        scenario: best.scenario || "",
        profitPA: best.totalProfitPA || 0,
        buyAllProfitPA,
      });

      processed++;
      if (processed % 50 === 0) {
        console.log(`Processed ${processed}/${orderedTickers.length} tickers...`);
      }
    } catch (err) {
      console.error(`Error processing ticker ${ticker}:`, err);
      // Continue with next ticker even if one fails
    }
  }

  return output;
}

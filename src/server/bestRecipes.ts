// src/server/bestRecipes.ts
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { findAllMakeOptions, buildScenarioRows, clearScenarioCache } from "@/core/engine";
import { CSV_URLS } from "@/lib/config";
import type { RecipeSheet } from "@/types";

export interface BestRecipeResult {
  ticker: string;
  recipeId: string | null;
  scenario: string;
  profitPA: number;
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

  // Load data
  const { recipeMap, pricesMap } = await loadAllFromCsv(CSV_URLS);

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

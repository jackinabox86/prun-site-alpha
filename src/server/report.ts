// src/server/report.ts
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { findAllMakeOptions, buildScenarioRows, buildScenarioRowsAtCapacity, clearScenarioCache } from "@/core/engine";
import { computeRoiNarrow, computeRoiBroad } from "@/core/roi";
import { cachedBestRecipes } from "@/server/cachedBestRecipes";
import { GCS_DATA_SOURCES, GCS_STATIC_BASE } from "@/lib/config";
import { scenarioDisplayName } from "@/core/scenario";
import type { Exchange, PriceType } from "@/types";

const honorRecipeIdFilter = false;  // Set to false to explore all recipe variants

/**
 * Deep-clone an option's scenario tree (option + madeInputDetails recursively).
 * buildScenarioRows annotates the tree it walks (childRunsPerDayRequired,
 * childDemandUnitsPerDay, totalProfitPA); serialized entries must be cloned
 * first so those writes never land on memo-shared objects where the last
 * caller would win.
 */
function cloneOptionTree<T extends { madeInputDetails?: any[] }>(option: T): T {
  return {
    ...option,
    madeInputDetails: (option.madeInputDetails || []).map((item: any) => ({
      ...item,
      details: item.details ? cloneOptionTree(item.details) : item.details,
    })),
  };
}

type WithMetrics<T> = T & {
  roiNarrowDays?: number | null;
  roiBroadDays?: number | null;
  inputPaybackDays7Narrow?: number | null;
  inputPaybackDays7Broad?: number | null;
  totalProfitPA?: number;
  totalAreaPerDay?: number;
  totalBuildCost?: number;
  totalInputBuffer7?: number;
};

export async function buildReport(opts: {
  ticker: string;
  exchange: Exchange;
  priceType: PriceType;
  forceMake?: string;
  forceBuy?: string;
  forceBidPrice?: string;
  forceAskPrice?: string;
  forceRecipe?: string;
  excludeRecipe?: string;
  extractionMode?: boolean;
}) {
  const { ticker, exchange, priceType, forceMake, forceBuy, forceBidPrice, forceAskPrice, forceRecipe, excludeRecipe, extractionMode = false } = opts;

  // Memo entries are keyed by data-map identity, so stale entries from prior
  // requests can never be reused; clearing here just bounds memory growth.
  clearScenarioCache();

  // Parse force constraints into sets
  const forceMakeSet = forceMake
    ? new Set(forceMake.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0))
    : undefined;
  const forceBuySet = forceBuy
    ? new Set(forceBuy.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0))
    : undefined;
  const forceRecipeSet = forceRecipe
    ? new Set(forceRecipe.split(',').map(r => r.trim().toUpperCase()).filter(r => r.length > 0))
    : undefined;
  const excludeRecipeSet = excludeRecipe
    ? new Set(excludeRecipe.split(',').map(r => r.trim().toUpperCase()).filter(r => r.length > 0))
    : undefined;

  // Parse price overrides into maps (ticker -> price)
  const forceBidPriceMap = new Map<string, number>();
  if (forceBidPrice) {
    forceBidPrice.split(',').forEach(entry => {
      const parts = entry.trim().split(':');
      if (parts.length === 2) {
        const t = parts[0].trim().toUpperCase();
        const price = parseFloat(parts[1].trim());
        if (t && !isNaN(price) && price >= 0) {
          forceBidPriceMap.set(t, price);
        }
      }
    });
  }

  const forceAskPriceMap = new Map<string, number>();
  if (forceAskPrice) {
    forceAskPrice.split(',').forEach(entry => {
      const parts = entry.trim().split(':');
      if (parts.length === 2) {
        const t = parts[0].trim().toUpperCase();
        const price = parseFloat(parts[1].trim());
        if (t && !isNaN(price) && price >= 0) {
          forceAskPriceMap.set(t, price);
        }
      }
    });
  }

  // Get cached best recipes matching the price source and extraction mode
  // Use exchange-specific best recipes, except UNV always uses ANT
  // Always use 'bid' for scenario pruning in main analysis
  // Load extraction-mode best recipes if extractionMode is enabled
  const bestRecipesExchange = exchange === "UNV" ? "ANT" : exchange;
  const bestRecipesMode = extractionMode ? 'extraction' : 'standard';
  const { bestMap } = await cachedBestRecipes.getBestRecipes(bestRecipesExchange, 'bid', bestRecipesMode);

  const dataSources = GCS_DATA_SOURCES;

  // Load recipes and prices from the appropriate source
  const { recipeMap, pricesMap } = await loadAllFromCsv(
    { recipes: dataSources.recipes, prices: dataSources.prices },
    { bestMap }
  );

  // loadAllFromCsv builds fresh maps on every call (only raw CSV rows are
  // cached in csvFetch), so mutating this map below is safe — no deep clone needed
  const workingRecipeMap = recipeMap;

  // If extraction mode is enabled for ANT, merge expanded recipes into recipeMap for runtime analysis
  // The bestMap already includes extraction scenarios from the extraction best recipes file
  if (extractionMode && exchange === "ANT") {
    const expandedRecipeUrl = `${GCS_STATIC_BASE}/ANT-expandedrecipes-dynamic.csv`;

    try {
      const expandedData = await loadAllFromCsv(
        { recipes: expandedRecipeUrl, prices: dataSources.prices },
        { bestMap } // Use the extraction-mode bestMap for consistency
      );
      const expandedRecipeMap = expandedData.recipeMap;

      // Merge expanded recipes, remapping every row by header name so a
      // column-order drift between the two generated CSVs (or the extra
      // "Planet" column) can't silently misalign fields
      const targetHeaders = workingRecipeMap.headers;
      const sourceIndex = new Map(expandedRecipeMap.headers.map((h, i) => [h, i]));
      const missing = targetHeaders.filter(h => !sourceIndex.has(h));
      if (missing.length > 0) {
        throw new Error(
          `ANT expanded recipes CSV is missing expected column(s): ${missing.join(", ")}`
        );
      }
      for (const [ticker, recipes] of Object.entries(expandedRecipeMap.map)) {
        if (!workingRecipeMap.map[ticker]) {
          workingRecipeMap.map[ticker] = [];
        }
        for (const recipe of recipes) {
          workingRecipeMap.map[ticker].push(
            targetHeaders.map(h => recipe[sourceIndex.get(h)!])
          );
        }
      }
    } catch (error: any) {
      throw new Error(`Failed to load ANT expanded recipes: ${error.message || error}`);
    }
  }

  // Apply price overrides if specified
  // We need to clone pricesMap before modifying to avoid mutating cached data
  // Deep clone the relevant tickers to ensure no cache corruption
  if (forceBidPriceMap.size > 0 || forceAskPriceMap.size > 0) {
    const tickersToClone = new Set([
      ...forceBidPriceMap.keys(),
      ...forceAskPriceMap.keys()
    ]);

    for (const t of tickersToClone) {
      if (pricesMap[t]) {
        // Deep clone the ticker's price data
        pricesMap[t] = {
          ...pricesMap[t],
          ANT: { ...pricesMap[t].ANT },
          CIS: { ...pricesMap[t].CIS },
          ICA: { ...pricesMap[t].ICA },
          NCC: { ...pricesMap[t].NCC },
          UNV: { ...pricesMap[t].UNV }
        };
      } else {
        // Initialize price data for ticker if it doesn't exist
        pricesMap[t] = {
          ANT: { bid: 0, ask: 0, pp7: 0, pp30: 0 },
          CIS: { bid: 0, ask: 0, pp7: 0, pp30: 0 },
          ICA: { bid: 0, ask: 0, pp7: 0, pp30: 0 },
          NCC: { bid: 0, ask: 0, pp7: 0, pp30: 0 },
          UNV: { bid: 0, ask: 0, pp7: 0, pp30: 0 }
        };
      }
    }

    // Apply bid price overrides to all exchanges
    for (const [t, price] of forceBidPriceMap.entries()) {
      if (pricesMap[t]) {
        pricesMap[t].ANT.bid = price;
        pricesMap[t].CIS.bid = price;
        pricesMap[t].ICA.bid = price;
        pricesMap[t].NCC.bid = price;
        pricesMap[t].UNV.bid = price;
      }
    }

    // Apply ask price overrides to all exchanges
    for (const [t, price] of forceAskPriceMap.entries()) {
      if (pricesMap[t]) {
        pricesMap[t].ANT.ask = price;
        pricesMap[t].CIS.ask = price;
        pricesMap[t].ICA.ask = price;
        pricesMap[t].NCC.ask = price;
        pricesMap[t].UNV.ask = price;
      }
    }
  }

  // Check if the ticker exists in price data
  const tickerPrices = pricesMap[ticker];
  if (!tickerPrices) {
    return {
      schemaVersion: 3,
      ticker,
      exchange,
      priceType,
      totalOptions: 0,
      bestPA: null,
      bestScenario: "",
      best: null,
      top20: [],
      error: `No price data available for ticker ${ticker}`,
    };
  }

  // Check if the ticker has price data for the selected exchange
  const exchangePrices = tickerPrices[exchange];
  if (!exchangePrices) {
    return {
      schemaVersion: 3,
      ticker,
      exchange,
      priceType,
      totalOptions: 0,
      bestPA: null,
      bestScenario: "",
      best: null,
      top20: [],
      error: `No price data available for ticker ${ticker} on exchange ${exchange}`,
    };
  }

  // Check if the ticker has a price for the selected price type
  const price = exchangePrices[priceType];
  if (!price) {
    // Special case: UNV exchange doesn't have bid/ask prices, only pp7/pp30
    if (exchange === "UNV" && (priceType === "bid" || priceType === "ask")) {
      return {
        schemaVersion: 3,
        ticker,
        exchange,
        priceType,
        totalOptions: 0,
        bestPA: null,
        bestScenario: "",
        best: null,
        top20: [],
        error: `Must sell at pp7 or pp30 if using UNV exchange.`,
      };
    }

    return {
      schemaVersion: 3,
      ticker,
      exchange,
      priceType,
      totalOptions: 0,
      bestPA: null,
      bestScenario: "",
      best: null,
      top20: [],
      error: `No ${priceType} price available for ticker ${ticker} on exchange ${exchange}`,
    };
  }

  // Validate recipe constraints against force make/buy
  if (forceRecipeSet || excludeRecipeSet) {
    const validationErrors: string[] = [];

    // Build recipe ID to ticker map
    const recipeToTicker = new Map<string, string>();
    for (const [ticker, rows] of Object.entries(workingRecipeMap.map)) {
      const recipeIdIdx = workingRecipeMap.headers.indexOf("RecipeID");
      if (recipeIdIdx !== -1) {
        for (const row of rows) {
          const recipeId = String(row[recipeIdIdx] ?? "").toUpperCase();
          if (recipeId) {
            recipeToTicker.set(recipeId, ticker);
          }
        }
      }
    }

    // Check for conflicts with force make/buy
    const allRecipeIds = new Set([
      ...(forceRecipeSet || []),
      ...(excludeRecipeSet || [])
    ]);

    for (const recipeId of allRecipeIds) {
      const recipeTicker = recipeToTicker.get(recipeId);
      if (!recipeTicker) {
        validationErrors.push(`Recipe ID "${recipeId}" does not exist in recipe data`);
        continue;
      }

      // Validate recipe ID format (should be TICKER_VARIANT, e.g., C_1, GRN_2)
      if (!recipeId.includes('_')) {
        validationErrors.push(`Recipe ID "${recipeId}" does not follow expected format "TICKER_VARIANT" (e.g., C_1, GRN_2). Recipe constraints are scoped by ticker prefix.`);
      } else {
        // Verify the ticker prefix matches the actual ticker
        const recipeIdPrefix = recipeId.split('_')[0];
        if (recipeIdPrefix !== recipeTicker) {
          validationErrors.push(`Recipe ID "${recipeId}" has prefix "${recipeIdPrefix}" but belongs to ticker "${recipeTicker}". This may cause unexpected filtering behavior.`);
        }
      }

      // Check if ticker is force-bought
      if (forceBuySet && forceBuySet.has(recipeTicker)) {
        validationErrors.push(`Conflict: Recipe "${recipeId}" for ticker "${recipeTicker}" cannot be used because "${recipeTicker}" is in Force Buy list`);
      }
    }

    // Check if all recipes for any ticker would be excluded
    if (forceRecipeSet || excludeRecipeSet) {
      const tickersWithRecipes = new Set<string>();
      for (const ticker of recipeToTicker.values()) {
        tickersWithRecipes.add(ticker);
      }

      for (const ticker of tickersWithRecipes) {
        // Get all recipe IDs for this ticker
        const recipeIdIdx = workingRecipeMap.headers.indexOf("RecipeID");
        const tickerRecipes = workingRecipeMap.map[ticker] || [];
        const allRecipeIdsForTicker = tickerRecipes
          .map(row => String(row[recipeIdIdx] ?? "").toUpperCase())
          .filter(id => id.length > 0);

        if (allRecipeIdsForTicker.length === 0) continue;

        // Filter based on constraints
        let availableRecipes = [...allRecipeIdsForTicker];

        // If force recipes exist for this ticker, only those are available
        const forcedRecipesForTicker = allRecipeIdsForTicker.filter(id => forceRecipeSet?.has(id));
        if (forceRecipeSet && forcedRecipesForTicker.length > 0) {
          availableRecipes = forcedRecipesForTicker;
        }

        // Remove excluded recipes
        if (excludeRecipeSet) {
          availableRecipes = availableRecipes.filter(id => !excludeRecipeSet.has(id));
        }

        // If no recipes remain, that's an error (unless ticker is force-bought)
        if (availableRecipes.length === 0 && (!forceBuySet || !forceBuySet.has(ticker))) {
          validationErrors.push(`All recipes for ticker "${ticker}" would be excluded. Available recipes: ${allRecipeIdsForTicker.join(', ')}`);
        }
      }
    }

    if (validationErrors.length > 0) {
      return {
        schemaVersion: 3,
        ticker,
        exchange,
        priceType,
        totalOptions: 0,
        bestPA: null,
        bestScenario: "",
        best: null,
        top20: [],
        topDisplayScenarios: [],
        error: `Recipe constraint validation failed:\n${validationErrors.join('\n')}`,
      };
    }
  }

  const options = findAllMakeOptions(ticker, workingRecipeMap, pricesMap, exchange, priceType, bestMap, 0, true, honorRecipeIdFilter, forceMakeSet, forceBuySet, forceRecipeSet, excludeRecipeSet);
  if (!options.length) {
    return {
      schemaVersion: 3,
      ticker,
      exchange,
      priceType,
      totalOptions: 0,
      bestPA: null,
      bestScenario: "",
      best: null,
      top20: [],
      error: `No production scenarios could be constructed for ticker ${ticker} with ${exchange} ${priceType} pricing. This usually means an input has neither a market price nor a producible recipe (or force constraints eliminated every option) — see server logs for the specific input.`,
    };
  }

  // Rank by Profit/Area at capacity
  const ranked = options
    .map(o => {
      const capacity = (o.output1Amount || 0) * (o.runsPerDay || 0);
      const r = buildScenarioRowsAtCapacity(o); // used for PA/area math only
      return { o, r, capacity };
    })
    .sort((a, b) => (b.r.subtreeProfitPerArea ?? 0) - (a.r.subtreeProfitPerArea ?? 0));

  // Best
  const best = ranked[0];

  // Numeric metrics for BEST (go on the raw object)
  const roi = computeRoiNarrow(best.o);       // { narrowDays, capex, basis }
  const baseProfitPerDay = best.o.baseProfitPerDay ?? 0;
  const totalBuildCost = best.r.subtreeBuildCost ?? 0;
  const roiBroad = computeRoiBroad(totalBuildCost, baseProfitPerDay);

  // Input buffer payback: narrow = self only, broad = entire tree
  const inputBuffer7Narrow = best.o.inputBuffer7 ?? 0;
  const inputBuffer7Broad = best.r.subtreeInputBuffer7 ?? 0;
  const inputPaybackNarrow = baseProfitPerDay > 0 ? inputBuffer7Narrow / baseProfitPerDay : null;
  const inputPaybackBroad = baseProfitPerDay > 0 ? inputBuffer7Broad / baseProfitPerDay : null;

  // Clone the tree and re-annotate the clone so serialized display values
  // (childRunsPerDayRequired etc.) are self-consistent for THIS scenario
  // rather than whatever the last buildScenarioRows caller wrote onto the
  // memo-shared objects
  const bestClone = cloneOptionTree(best.o);
  buildScenarioRows(bestClone, 0, best.capacity, false);

  const bestRaw: WithMetrics<typeof best.o> = {
    ...bestClone,
    totalProfitPA: best.r.subtreeProfitPerArea ?? 0,
    totalAreaPerDay: best.r.subtreeAreaPerDay ?? 0,
    totalBuildCost: totalBuildCost,
    totalInputBuffer7: best.r.subtreeInputBuffer7 ?? 0,
    roiNarrowDays: roi.narrowDays ?? null,
    roiBroadDays: roiBroad.broadDays ?? null,
    inputPaybackDays7Narrow: inputPaybackNarrow,
    inputPaybackDays7Broad: inputPaybackBroad,
  };


  // Top 20 summary: include ROI only (no rows here)
  const top20: Array<WithMetrics<typeof ranked[number]["o"]>> = ranked.slice(0, 20).map(({ o, r, capacity }) => {
    const roi = computeRoiNarrow(o);
    const baseProfitPerDay = o.baseProfitPerDay ?? 0;
    const totalBuildCost = r.subtreeBuildCost ?? 0;
    const roiBroad = computeRoiBroad(totalBuildCost, baseProfitPerDay);

    // Input buffer payback: narrow = self only, broad = entire tree
    const inputBuffer7Narrow = o.inputBuffer7 ?? 0;
    const inputBuffer7Broad = r.subtreeInputBuffer7 ?? 0;
    const inputPaybackNarrow = baseProfitPerDay > 0 ? inputBuffer7Narrow / baseProfitPerDay : null;
    const inputPaybackBroad = baseProfitPerDay > 0 ? inputBuffer7Broad / baseProfitPerDay : null;

    const clone = cloneOptionTree(o);
    buildScenarioRows(clone, 0, capacity, false);

    return {
      ...clone,
      totalProfitPA: r.subtreeProfitPerArea ?? 0,
      totalAreaPerDay: r.subtreeAreaPerDay ?? 0,
      totalBuildCost: totalBuildCost,
      totalInputBuffer7: r.subtreeInputBuffer7 ?? 0,
      roiNarrowDays: roi.narrowDays ?? null,
      roiBroadDays: roiBroad.broadDays ?? null,
      inputPaybackDays7Narrow: inputPaybackNarrow,
      inputPaybackDays7Broad: inputPaybackBroad,
    };
  });

  // Group by display scenario and keep best option for each
  const displayScenarioMap = new Map<string, { o: typeof ranked[number]["o"]; r: typeof ranked[number]["r"] }>();
  for (const item of ranked) {
    const displayScenario = scenarioDisplayName(item.o.scenario || "");
    const profitPA = item.r.subtreeProfitPerArea ?? 0;

    if (!displayScenarioMap.has(displayScenario) ||
        profitPA > (displayScenarioMap.get(displayScenario)!.r.subtreeProfitPerArea ?? 0)) {
      displayScenarioMap.set(displayScenario, item);
    }
  }

  // Convert to array and create metrics for top display scenarios (limit to 20)
  const topDisplayScenarios: Array<WithMetrics<typeof ranked[number]["o"]>> = Array.from(displayScenarioMap.values()).map(({ o, r }) => {
    const roi = computeRoiNarrow(o);
    const baseProfitPerDay = o.baseProfitPerDay ?? 0;
    const totalBuildCost = r.subtreeBuildCost ?? 0;
    const roiBroad = computeRoiBroad(totalBuildCost, baseProfitPerDay);

    // Input buffer payback: narrow = self only, broad = entire tree
    const inputBuffer7Narrow = o.inputBuffer7 ?? 0;
    const inputBuffer7Broad = r.subtreeInputBuffer7 ?? 0;
    const inputPaybackNarrow = baseProfitPerDay > 0 ? inputBuffer7Narrow / baseProfitPerDay : null;
    const inputPaybackBroad = baseProfitPerDay > 0 ? inputBuffer7Broad / baseProfitPerDay : null;

    const clone = cloneOptionTree(o);
    buildScenarioRows(clone, 0, (o.output1Amount || 0) * (o.runsPerDay || 0), false);

    return {
      ...clone,
      totalProfitPA: r.subtreeProfitPerArea ?? 0,
      totalAreaPerDay: r.subtreeAreaPerDay ?? 0,
      totalBuildCost: totalBuildCost,
      totalInputBuffer7: r.subtreeInputBuffer7 ?? 0,
      roiNarrowDays: roi.narrowDays ?? null,
      roiBroadDays: roiBroad.broadDays ?? null,
      inputPaybackDays7Narrow: inputPaybackNarrow,
      inputPaybackDays7Broad: inputPaybackBroad,
    };
  }).sort((a, b) => (b.totalProfitPA ?? 0) - (a.totalProfitPA ?? 0)).slice(0, 20); // Sort by profit P/A descending and limit to 20

  return {
    schemaVersion: 3,
    ticker,
    exchange,
    priceType,
    totalOptions: ranked.length,
    bestPA: best.r.subtreeProfitPerArea ?? null,
    bestScenario: best.o.scenario ?? "",
    best: bestRaw,
    top20,
    topDisplayScenarios,
  };
}

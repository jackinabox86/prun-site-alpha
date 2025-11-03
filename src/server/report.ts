// src/server/report.ts
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { findAllMakeOptions, buildScenarioRows } from "@/core/engine";
import { computeRoiNarrow, computeRoiBroad } from "@/core/roi";
import { computeInputPayback } from "@/core/inputPayback";
import { cachedBestRecipes } from "@/server/cachedBestRecipes";
import { LOCAL_DATA_SOURCES, GCS_DATA_SOURCES } from "@/lib/config";
import { scenarioDisplayName } from "@/core/scenario";
import type { PriceMode, Exchange, PriceType } from "@/types";

const honorRecipeIdFilter = false;  // Set to false to explore all recipe variants

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
  priceSource?: "local" | "gcs";
  forceMake?: string;
  forceBuy?: string;
}) {
  const { ticker, exchange, priceType, priceSource = "local", forceMake, forceBuy } = opts;

  // Parse force constraints into sets
  const forceMakeSet = forceMake
    ? new Set(forceMake.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0))
    : undefined;
  const forceBuySet = forceBuy
    ? new Set(forceBuy.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0))
    : undefined;

  // Get cached best recipes matching the price source
  // Use exchange-specific best recipes, except UNV always uses ANT
  const bestRecipesExchange = exchange === "UNV" ? "ANT" : exchange;
  const { bestMap } = await cachedBestRecipes.getBestRecipes(priceSource, bestRecipesExchange);

  // Determine which data sources to use based on priceSource
  const dataSources = priceSource === "gcs" ? GCS_DATA_SOURCES : LOCAL_DATA_SOURCES;

  // Load recipes and prices from the appropriate source
  const { recipeMap, pricesMap } = await loadAllFromCsv(
    { recipes: dataSources.recipes, prices: dataSources.prices },
    { bestMap }
  );

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

  const options = findAllMakeOptions(ticker, recipeMap, pricesMap, exchange, priceType, bestMap, 0, true, honorRecipeIdFilter, forceMakeSet, forceBuySet);
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
      error: `No profitable production scenarios found for ticker ${ticker} with ${exchange} ${priceType} pricing`,
    };
  }

  // Rank by Profit/Area at capacity
  const ranked = options
    .map(o => {
      const capacity = (o.output1Amount || 0) * (o.runsPerDay || 0);
      const r = buildScenarioRows(o, 0, capacity, false); // used for PA/area math only
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
  const ip  = computeInputPayback(best.o, 7); // { days, windowDays }

  // Input buffer payback: narrow = self only, broad = entire tree
  const inputBuffer7Narrow = best.o.inputBuffer7 ?? 0;
  const inputBuffer7Broad = best.r.subtreeInputBuffer7 ?? 0;
  const inputPaybackNarrow = baseProfitPerDay > 0 ? inputBuffer7Narrow / baseProfitPerDay : null;
  const inputPaybackBroad = baseProfitPerDay > 0 ? inputBuffer7Broad / baseProfitPerDay : null;

  const bestRaw: WithMetrics<typeof best.o> = {
    ...best.o,
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
  const top20: Array<WithMetrics<typeof ranked[number]["o"]>> = ranked.slice(0, 20).map(({ o, r }) => {
    const roi = computeRoiNarrow(o);
    const baseProfitPerDay = o.baseProfitPerDay ?? 0;
    const totalBuildCost = r.subtreeBuildCost ?? 0;
    const roiBroad = computeRoiBroad(totalBuildCost, baseProfitPerDay);

    // Input buffer payback: narrow = self only, broad = entire tree
    const inputBuffer7Narrow = o.inputBuffer7 ?? 0;
    const inputBuffer7Broad = r.subtreeInputBuffer7 ?? 0;
    const inputPaybackNarrow = baseProfitPerDay > 0 ? inputBuffer7Narrow / baseProfitPerDay : null;
    const inputPaybackBroad = baseProfitPerDay > 0 ? inputBuffer7Broad / baseProfitPerDay : null;

    return {
      ...o,
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

    return {
      ...o,
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

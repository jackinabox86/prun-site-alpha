// src/core/engine.ts
import {
  BestMap,
  MakeOption,
  PriceMode,
  PricesMap,
  RecipeMap,
  ScenarioRowsResult,
  Exchange,
  PriceType,
} from "../types";
import { findPrice } from "./price";
import { composeScenario, scenarioDisplayName } from "./scenario";

/**──────────────────────────────────────────────────────────────────────────────
 * Helper: Determine which price type to use for buying inputs
 * UNV exchange doesn't have ask/bid prices, so use the selected priceType
 *─────────────────────────────────────────────────────────────────────────────*/
function getInputPriceType(exchange: Exchange, priceType: PriceType): PriceType {
  return exchange === "UNV" ? priceType : "ask";
}

/**──────────────────────────────────────────────────────────────────────────────
 * Helper: Get exchange-specific column names for cost fields
 * For UNV, appends price type suffix (7 for pp7, 30 for pp30)
 *─────────────────────────────────────────────────────────────────────────────*/
function getCostColumnNames(exchange: Exchange, priceType: PriceType) {
  // For UNV, append price type suffix since UNV has separate columns for PP7 and PP30
  const suffix = exchange === "UNV"
    ? (priceType === "pp7" ? "7" : "30")
    : "";

  return {
    wfCst: `WfCst-${exchange}${suffix}`,
    deprec: `Deprec-${exchange}${suffix}`,
    allBuildCst: `AllBuildCst-${exchange}${suffix}`
  };
}

/**──────────────────────────────────────────────────────────────────────────────
 * Memoization for child scenarios
 *─────────────────────────────────────────────────────────────────────────────*/
const BEST_MEMO = new Map<string, MakeOption>();
const ALL_SCENARIOS_MEMO = new Map<string, MakeOption[]>();

const memoKey = (
  exchange: Exchange,
  priceType: PriceType,
  ticker: string,
  forceMake?: Set<string>,
  forceBuy?: Set<string>
) => {
  // Serialize force constraints into the cache key
  const forceMakeStr = forceMake && forceMake.size > 0
    ? Array.from(forceMake).sort().join(',')
    : '';
  const forceBuyStr = forceBuy && forceBuy.size > 0
    ? Array.from(forceBuy).sort().join(',')
    : '';
  return `${exchange}::${priceType}::${ticker}::${forceMakeStr}::${forceBuyStr}`;
};

/** Clear all caches - call this between different analyses if needed */
export function clearScenarioCache() {
  BEST_MEMO.clear();
  ALL_SCENARIOS_MEMO.clear();
}

/**
 * Shallow clone for cache returns
 * NOTE: Cached objects should be treated as immutable. Do not modify returned objects.
 * Deep structures (madeInputDetails) are shared references - mutations affect cache.
 */
function shallowClone<T>(v: T): T {
  if (Array.isArray(v)) {
    return [...v] as T;
  }
  if (v && typeof v === 'object') {
    return { ...v };
  }
  return v;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Prune options to keep top N by P/A plus one representative of each simple scenario
 */
function pruneForDiversity(options: MakeOption[], topN: number): MakeOption[] {
  if (options.length <= topN) return options;

  // Rank by P/A
  const ranked = options
    .map(opt => {
      const capacity = (opt.output1Amount || 0) * (opt.runsPerDay || 0);
      const res = buildScenarioRows(opt, 0, capacity, false);
      return { opt, pa: res.subtreeProfitPerArea ?? -Infinity };
    })
    .sort((a, b) => b.pa - a.pa);

  // Keep top N
  const keepSet = new Set(ranked.slice(0, topN).map(x => x.opt));

  // Add best representative of each simple scenario
  const bySimpleScenario = new Map<string, { opt: MakeOption; pa: number }>();
  for (const item of ranked) {
    const simple = scenarioDisplayName(item.opt.scenario || "");
    if (!bySimpleScenario.has(simple) || item.pa > bySimpleScenario.get(simple)!.pa) {
      bySimpleScenario.set(simple, item);
    }
  }

  for (const item of bySimpleScenario.values()) {
    keepSet.add(item.opt);
  }

  // Return in original order, filtered
  return options.filter(o => keepSet.has(o));
}

/**
 * Adaptive pruning based on input cost significance
 * Prunes more aggressively for inputs that are small cost contributors
 */
function pruneByInputCostShare(
  inputs: Array<{
    ticker: string;
    amount: number;
    buyCost: number | null;
    childOptions: MakeOption[];
  }>,
  depth: number,
  exploreAllChildScenarios: boolean
): void {
  if (!exploreAllChildScenarios || inputs.length === 0) return;

  // Estimate each input's cost contribution
  const inputCosts = inputs.map(inp => {
    // Use buy cost if available, otherwise estimate from best child option
    let estimatedCost = inp.buyCost ?? 0;
    if (estimatedCost === 0 && inp.childOptions.length > 0) {
      // Use first option (likely best by P/A) as cost estimate
      estimatedCost = (inp.childOptions[0].cogmPerOutput ?? 0) * inp.amount;
    }
    return { input: inp, cost: estimatedCost };
  });

  const totalEstimatedCost = inputCosts.reduce((sum, x) => sum + x.cost, 0);
  if (totalEstimatedCost === 0) return;

  // Apply cost-aware pruning
  for (const item of inputCosts) {
    const costShare = item.cost / totalEstimatedCost;
    
    if (costShare < 0.05) {
      // Tiny cost contributor (<5%): single option only
      item.input.childOptions = item.input.childOptions.slice(0, 1);
    } else if (costShare < 0.15) {
      // Minor cost contributor (5-15%): keep 2-3 scenarios
      item.input.childOptions = pruneForDiversity(item.input.childOptions, 2);
    } else if (costShare < 0.30) {
      // Moderate contributor (15-30%): keep 4-5 scenarios
      const target = depth === 0 ? 5 : 3;
      item.input.childOptions = pruneForDiversity(item.input.childOptions, target);
    }
    // Major contributors (>30%): keep all pruned scenarios from upstream
  }
}

/**
 * Build top N options for a ticker based on stored display scenarios
 * Returns options that match the stored top display scenarios from bestMap
 */
function topDisplayScenarioOptionsForTicker(
  materialTicker: string,
  recipeMap: RecipeMap,
  priceMap: PricesMap,
  exchange: Exchange,
  priceType: PriceType,
  bestMap: any, // Enhanced BestMap with top3DisplayScenarios
  honorRecipeIdFilter: boolean,
  seen: Set<string> = new Set(),
  forceMake?: Set<string>,
  forceBuy?: Set<string>
): MakeOption[] {
  const bestEntry = bestMap?.[materialTicker];
  if (!bestEntry || !bestEntry.top3DisplayScenarios || bestEntry.top3DisplayScenarios.length === 0) {
    // Fallback to single best option
    const best = bestOptionForTicker(materialTicker, recipeMap, priceMap, exchange, priceType, bestMap, honorRecipeIdFilter, seen, forceMake, forceBuy);
    return best ? [best] : [];
  }

  // Build all options for this ticker and match against stored display scenarios
  const allOptions = buildAllOptionsForTicker(materialTicker, recipeMap, priceMap, exchange, priceType, bestMap, honorRecipeIdFilter, seen, forceMake, forceBuy);

  // Match options to the stored top 3 display scenarios
  const matchedOptions: MakeOption[] = [];
  for (const topScenario of bestEntry.top3DisplayScenarios) {
    // Find the best option that matches this display scenario
    for (const opt of allOptions) {
      const optDisplayScenario = scenarioDisplayName(opt.scenario || "");
      if (norm(optDisplayScenario) === norm(topScenario.displayScenario)) {
        matchedOptions.push(opt);
        break; // Take first match for each display scenario
      }
    }
  }

  return matchedOptions.length > 0 ? matchedOptions : allOptions.slice(0, 1);
}

/**
 * Helper function to build all scenario options for a ticker
 * Used by topDisplayScenarioOptionsForTicker
 */
function buildAllOptionsForTicker(
  materialTicker: string,
  recipeMap: RecipeMap,
  priceMap: PricesMap,
  exchange: Exchange,
  priceType: PriceType,
  bestMap: any,
  honorRecipeIdFilter: boolean,
  seen: Set<string>,
  forceMake?: Set<string>,
  forceBuy?: Set<string>
): MakeOption[] {
  const headers = recipeMap.headers;
  const rows = recipeMap.map[materialTicker] || [];
  if (!rows.length) return [];

  const costCols = getCostColumnNames(exchange, priceType);
  const idx = {
    recipeId: headers.indexOf("RecipeID"),
    wf: headers.indexOf(costCols.wfCst),
    dep: headers.indexOf(costCols.deprec),
    area: headers.indexOf("Area"),
    build: headers.indexOf(costCols.allBuildCst),
    runs: headers.indexOf("Runs P/D"),
    areaPerOut: headers.indexOf("AreaPerOutput"),
  };

  const bestEntry = bestMap?.[materialTicker] ?? null;
  const bestId = bestEntry?.recipeId ?? null;

  // Filter recipes if needed
  const rowsToUse0 = (bestId && honorRecipeIdFilter)
    ? rows.filter((r) => String(r[idx.recipeId] ?? "") === bestId)
    : rows;
  const rowsToUse = rowsToUse0.length ? rowsToUse0 : rows;

  const allOptions: MakeOption[] = [];

  for (const row of rowsToUse) {
    const recipeId = idx.recipeId !== -1 ? String(row[idx.recipeId] ?? "") : null;
    const runsPerDay = Math.max(1, Number(row[idx.runs] ?? 0) || 1);
    const area = Math.max(1, Number(row[idx.area] ?? 0) || 1);
    const areaPerOutCell = Number(row[idx.areaPerOut] ?? 0);
    const areaPerOutput = areaPerOutCell > 0 ? areaPerOutCell : null;
    const workforceCost = Number(row[idx.wf] ?? 0) || 0;
    const depreciationCost = Number(row[idx.dep] ?? 0) || 0;
    const totalProductionCostBase = workforceCost + depreciationCost;
    const buildCost = Number(row[idx.build] ?? 0) || 0;

    // Collect inputs - for each input, use best child option only
    type InputItem = {
      ticker: string;
      amount: number;
      buyCost: number | null;
      childBest: MakeOption | null;
    };
    const inputs: InputItem[] = [];
    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Input${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Input${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const inputTicker = String(row[matIndex]);
        const inputAmount = Number(row[cntIndex] ?? 0);
        const inputPriceType = getInputPriceType(exchange, priceType);
        const inputPrice = findPrice(inputTicker, priceMap, exchange, inputPriceType);
        const buyCost = inputPrice != null ? inputAmount * inputPrice : null;
        const childBest = bestOptionForTicker(
          inputTicker,
          recipeMap,
          priceMap,
          exchange,
          priceType,
          bestMap,
          honorRecipeIdFilter,
          seen,
          forceMake,
          forceBuy
        );
        inputs.push({ ticker: inputTicker, amount: inputAmount, buyCost, childBest });
      }
    }

    // Outputs
    let totalOutputValue = 0;
    let byproductValue = 0;
    let output1Amount = 0;
    let output1HasPrice = false;
    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Output${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Output${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const outTicker = String(row[matIndex]);
        const outAmt = Number(row[cntIndex] ?? 0);
        const outPrice = findPrice(outTicker, priceMap, exchange, priceType);

        if (j === 0) {
          // Main ticker must have a price
          output1Amount = outAmt;
          if (outPrice) {
            output1HasPrice = true;
            const totalVal = outAmt * outPrice;
            totalOutputValue += totalVal;
          }
        } else {
          // Byproducts are optional
          if (outPrice) {
            const totalVal = outAmt * outPrice;
            totalOutputValue += totalVal;
            byproductValue += totalVal;
          }
        }
      }
    }

    // Skip this recipe if the main output ticker doesn't have a price for the selected price mode
    if (!output1HasPrice) {
      continue;
    }

    // Build scenarios for THIS ticker: each input → BUY or MAKE(childBest)
    type Scn = {
      scenarioName: string;
      totalInputCost: number;
      totalOpportunityCost: number;
      madeInputDetails: any[];
    };
    let scenarios: Scn[] = [
      {
        scenarioName: "",
        totalInputCost: 0,
        totalOpportunityCost: 0,
        madeInputDetails: [],
      },
    ];

    for (const input of inputs) {
      const branched: Scn[] = [];

      // Check force constraints
      const isForcedMake = forceMake && forceMake.has(input.ticker);
      const isForcedBuy = forceBuy && forceBuy.has(input.ticker);

      // BUY branch (skip if forced to make)
      if (input.buyCost != null && !isForcedMake) {
        for (const scn of scenarios) {
          const fullName = composeScenario(scn.scenarioName, {
            type: "BUY",
            inputTicker: input.ticker,
          });
          branched.push({
            scenarioName: fullName,
            totalInputCost: scn.totalInputCost + input.buyCost,
            totalOpportunityCost: scn.totalOpportunityCost,
            madeInputDetails: [
              ...scn.madeInputDetails,
              {
                recipeId: null,
                ticker: input.ticker,
                details: null,
                amountNeeded: input.amount,
                scenarioName: fullName,
                source: "BUY" as const,
                unitCost: input.amount > 0 ? input.buyCost / input.amount : input.buyCost,
                totalCostPerBatch: input.buyCost,
                childScenario: null,
              },
            ],
          });
        }
      }

      // MAKE branch (single best child only, if available) (skip if forced to buy)
      if (input.childBest && !isForcedBuy) {
        for (const scn of scenarios) {
          const mo = input.childBest;
          const fullName = composeScenario(scn.scenarioName, {
            type: "MAKE",
            inputTicker: input.ticker,
            recipeLabel: mo.recipeId ? mo.recipeId : mo.ticker,
            childScenario: mo.scenario || "",
          });
          branched.push({
            scenarioName: fullName,
            totalInputCost: scn.totalInputCost + mo.cogmPerOutput * input.amount,
            totalOpportunityCost:
              scn.totalOpportunityCost + mo.baseProfitPerOutput * input.amount,
            madeInputDetails: [
              ...scn.madeInputDetails,
              {
                recipeId: mo.recipeId,
                ticker: input.ticker,
                details: mo,
                amountNeeded: input.amount,
                scenarioName: fullName,
                source: "MAKE" as const,
                unitCost: null,
                totalCostPerBatch: mo.cogmPerOutput * input.amount,
                childScenario: mo.scenario || null,
              },
            ],
          });
        }
      }

      scenarios = branched;
    }

    // Convert scenarios → MakeOptions
    for (const scn of scenarios) {
      const totalInputCost = scn.totalInputCost;
      const totalProductionCost = totalInputCost + totalProductionCostBase;
      const baseProfit = totalOutputValue - totalProductionCost;
      const finalProfit = baseProfit - scn.totalOpportunityCost;

      const cogmPerOutput =
        output1Amount > 0
          ? (totalProductionCost - byproductValue) / output1Amount
          : 0;
      const baseProfitPerOutput =
        output1Amount > 0 ? baseProfit / output1Amount : 0;
      const adjProfitPerOutput =
        output1Amount > 0 ? finalProfit / output1Amount : 0;
      const valuePerOutput =
        output1Amount > 0 ? totalOutputValue / output1Amount : 0;

      const selfAreaPerDay =
        areaPerOutput && areaPerOutput > 0
          ? areaPerOutput
          : runsPerDay > 0 && output1Amount > 0
          ? area / (runsPerDay * output1Amount)
          : null;

      const inputBuffer7 = 7 * ((totalInputCost + workforceCost) * runsPerDay);

      const opt: MakeOption = {
        recipeId,
        ticker: materialTicker,
        scenario: scn.scenarioName,
        baseProfit,
        profit: finalProfit,
        cogmPerOutput,
        baseProfitPerOutput,
        adjProfitPerOutput,
        valuePerOutput,
        selfAreaPerDay,
        fullSelfAreaPerDay: area,
        profitPerDay: finalProfit * runsPerDay,
        baseProfitPerDay: baseProfit * runsPerDay,
        cost: totalInputCost,
        workforceCost,
        depreciationCost,
        totalOutputValue,
        byproductValue,
        totalOpportunityCost: scn.totalOpportunityCost,
        runsPerDay,
        area,
        buildCost,
        inputBuffer7,
        output1Amount,
        madeInputDetails: scn.madeInputDetails,
      };

      // Calculate P/A for this option
      const dailyCapacity = (opt.output1Amount || 0) * (opt.runsPerDay || 0);
      const res = buildScenarioRows(opt, 0, dailyCapacity, false);
      (opt as any).totalProfitPA = res.subtreeProfitPerArea ?? 0;

      allOptions.push(opt);
    }
  }

  return allOptions;
}

/**
 * Build the single best option for a ticker (used for children/grandchildren).
 * Selection logic:
 *   1) Build scenarios for THIS ticker only (each input → BUY or MAKE(childBest)).
 *   2) If bestMap has a Scenario string for this ticker, select the option whose
 *      `scenario` matches that string exactly (after normalization).
 *   3) Otherwise (no Scenario in bestMap or no exact match), fall back to the
 *      option with the highest Profit/Area at this ticker's capacity.
 * Also honors bestMap.recipeId by filtering candidate recipes to that ID (if honorRecipeIdFilter is true).
 */
function bestOptionForTicker(
  materialTicker: string,
  recipeMap: RecipeMap,
  priceMap: PricesMap,
  exchange: Exchange,
  priceType: PriceType,
  bestMap: BestMap,
  honorRecipeIdFilter: boolean,
  seen: Set<string> = new Set(),
  forceMake?: Set<string>,
  forceBuy?: Set<string>
): MakeOption | null {
  const mkey = memoKey(exchange, priceType, materialTicker, forceMake, forceBuy);
  if (BEST_MEMO.has(mkey)) return BEST_MEMO.get(mkey)!;

  // guard against cycles
  if (seen.has(materialTicker)) return null;
  const nextSeen = new Set(seen);
  nextSeen.add(materialTicker);

  const headers = recipeMap.headers;
  const rows = recipeMap.map[materialTicker] || [];
  if (!rows.length) return null;

  const costCols = getCostColumnNames(exchange, priceType);
  const idx = {
    recipeId: headers.indexOf("RecipeID"),
    wf: headers.indexOf(costCols.wfCst),
    dep: headers.indexOf(costCols.deprec),
    area: headers.indexOf("Area"),
    build: headers.indexOf(costCols.allBuildCst),
    runs: headers.indexOf("Runs P/D"),
    areaPerOut: headers.indexOf("AreaPerOutput"),
  };

  const bestEntry = bestMap?.[materialTicker] ?? null;
  const bestId = bestEntry?.recipeId ?? null;
  const expectedScenario = norm((bestEntry?.scenario ?? ""));

  // If bestMap gives a recipeId and we honor filtering, only consider that recipe
  const rowsToUse0 = (bestId && honorRecipeIdFilter)
    ? rows.filter((r) => String(r[idx.recipeId] ?? "") === bestId)
    : rows;
  const rowsToUse = rowsToUse0.length ? rowsToUse0 : rows;

  let chosenByPA: { opt: MakeOption; pa: number } | null = null;
  let chosenByScenario: MakeOption | null = null;

  for (const row of rowsToUse) {
    const recipeId =
      idx.recipeId !== -1 ? String(row[idx.recipeId] ?? "") : null;

    const runsPerDay = Math.max(1, Number(row[idx.runs] ?? 0) || 1);
    const area = Math.max(1, Number(row[idx.area] ?? 0) || 1);
    const areaPerOutCell = Number(row[idx.areaPerOut] ?? 0);
    const areaPerOutput = areaPerOutCell > 0 ? areaPerOutCell : null;

    const workforceCost = Number(row[idx.wf] ?? 0) || 0;
    const depreciationCost = Number(row[idx.dep] ?? 0) || 0;
    const totalProductionCostBase = workforceCost + depreciationCost;
    const buildCost = Number(row[idx.build] ?? 0) || 0;

    // Collect inputs (up to 10) → for each input, use BUY(ask) or MAKE(childBest)
    type InputItem = {
      ticker: string;
      amount: number;
      buyCost: number | null;
      childBest: MakeOption | null;
    };
    const inputs: InputItem[] = [];
    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Input${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Input${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const inputTicker = String(row[matIndex]);
        const inputAmount = Number(row[cntIndex] ?? 0);
        const inputPriceType = getInputPriceType(exchange, priceType);
        const inputPrice = findPrice(inputTicker, priceMap, exchange, inputPriceType);
        const buyCost = inputPrice != null ? inputAmount * inputPrice : null;
        const childBest = bestOptionForTicker(
          inputTicker,
          recipeMap,
          priceMap,
          exchange,
          priceType,
          bestMap,
          honorRecipeIdFilter,
          nextSeen,
          forceMake,
          forceBuy
        );
        inputs.push({ ticker: inputTicker, amount: inputAmount, buyCost, childBest });
      }
    }

    // Outputs (valuation on selected side for this ticker)
    let totalOutputValue = 0;
    let byproductValue = 0;
    let output1Amount = 0;
    let output1HasPrice = false;
    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Output${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Output${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const outTicker = String(row[matIndex]);
        const outAmt = Number(row[cntIndex] ?? 0);
        const outPrice = findPrice(outTicker, priceMap, exchange, priceType);

        if (j === 0) {
          // Main ticker must have a price
          output1Amount = outAmt;
          if (outPrice) {
            output1HasPrice = true;
            const totalVal = outAmt * outPrice;
            totalOutputValue += totalVal;
          }
        } else {
          // Byproducts are optional
          if (outPrice) {
            const totalVal = outAmt * outPrice;
            totalOutputValue += totalVal;
            byproductValue += totalVal;
          }
        }
      }
    }

    // Skip this recipe if the main output ticker doesn't have a price for the selected price mode
    if (!output1HasPrice) {
      continue;
    }

    // Build scenarios for THIS ticker only: each input → BUY or MAKE(childBest)
    type Scn = {
      scenarioName: string;
      totalInputCost: number;
      totalOpportunityCost: number;
      madeInputDetails: any[];
    };
    let scenarios: Scn[] = [
      {
        scenarioName: "",
        totalInputCost: 0,
        totalOpportunityCost: 0,
        madeInputDetails: [],
      },
    ];

    for (const input of inputs) {
      const branched: Scn[] = [];

      // Check force constraints
      const isForcedMake = forceMake && forceMake.has(input.ticker);
      const isForcedBuy = forceBuy && forceBuy.has(input.ticker);

      // BUY branch (skip if forced to make)
      if (input.buyCost != null && !isForcedMake) {
        for (const scn of scenarios) {
          const fullName = composeScenario(scn.scenarioName, {
            type: "BUY",
            inputTicker: input.ticker,
          });
          branched.push({
            scenarioName: fullName,
            totalInputCost: scn.totalInputCost + input.buyCost,
            totalOpportunityCost: scn.totalOpportunityCost,
            madeInputDetails: [
              ...scn.madeInputDetails,
              {
                recipeId: null,
                ticker: input.ticker,
                details: null,
                amountNeeded: input.amount,
                scenarioName: fullName,
                source: "BUY" as const,
                unitCost:
                  input.amount > 0 ? input.buyCost / input.amount : input.buyCost,
                totalCostPerBatch: input.buyCost,
                childScenario: null,
              },
            ],
          });
        }
      }

      // MAKE branch (single best child only, if available) (skip if forced to buy)
      if (input.childBest && !isForcedBuy) {
        for (const scn of scenarios) {
          const mo = input.childBest;
          const fullName = composeScenario(scn.scenarioName, {
            type: "MAKE",
            inputTicker: input.ticker,
            recipeLabel: mo.recipeId ? mo.recipeId : mo.ticker,
            childScenario: mo.scenario || "",
          });
          branched.push({
            scenarioName: fullName,
            totalInputCost: scn.totalInputCost + mo.cogmPerOutput * input.amount,
            totalOpportunityCost:
              scn.totalOpportunityCost + mo.baseProfitPerOutput * input.amount,
            madeInputDetails: [
              ...scn.madeInputDetails,
              {
                recipeId: mo.recipeId,
                ticker: input.ticker,
                details: mo,
                amountNeeded: input.amount,
                scenarioName: fullName,
                source: "MAKE" as const,
                unitCost: null,
                totalCostPerBatch: mo.cogmPerOutput * input.amount,
                childScenario: mo.scenario || null,
              },
            ],
          });
        }
      }

      scenarios = branched;
    }

    // Convert scenarios → MakeOption(s) and select by Scenario string OR best P/A
    for (const scn of scenarios) {
      const totalInputCost = scn.totalInputCost;
      const totalProductionCost = totalInputCost + totalProductionCostBase;
      const baseProfit = totalOutputValue - totalProductionCost;
      const finalProfit = baseProfit - scn.totalOpportunityCost;

      const cogmPerOutput =
        output1Amount > 0
          ? (totalProductionCost - byproductValue) / output1Amount
          : 0;
      const baseProfitPerOutput =
        output1Amount > 0 ? baseProfit / output1Amount : 0;
      const adjProfitPerOutput =
        output1Amount > 0 ? finalProfit / output1Amount : 0;
      const valuePerOutput =
        output1Amount > 0 ? totalOutputValue / output1Amount : 0;

      const selfAreaPerDay =
        areaPerOutput && areaPerOutput > 0
          ? areaPerOutput
          : runsPerDay > 0 && output1Amount > 0
          ? area / (runsPerDay * output1Amount)
          : null;

      const inputBuffer7 =
  7 * ((totalInputCost + workforceCost) * runsPerDay);

      const opt: MakeOption = {
        recipeId,
        ticker: materialTicker,
        scenario: scn.scenarioName,
        baseProfit,
        profit: finalProfit,
        cogmPerOutput,
        baseProfitPerOutput,
        adjProfitPerOutput,
        valuePerOutput,
        selfAreaPerDay,
        fullSelfAreaPerDay: area,
        profitPerDay: finalProfit * runsPerDay,
        baseProfitPerDay: baseProfit * runsPerDay,
        cost: totalInputCost,
        workforceCost,
        depreciationCost,
        totalOutputValue,
        byproductValue,
        totalOpportunityCost: scn.totalOpportunityCost,
        runsPerDay,
        area,
        buildCost,
        inputBuffer7,
        output1Amount,
        madeInputDetails: scn.madeInputDetails,
      };

      // Evaluate P/A at this ticker's capacity
      const dailyCapacity = (opt.output1Amount || 0) * (opt.runsPerDay || 0);
      const res = buildScenarioRows(opt, 0, dailyCapacity, false);
      const pa = res.subtreeProfitPerArea ?? -Infinity;

      // Always track best-by-PA as fallback
      if (!chosenByPA || pa > chosenByPA.pa) chosenByPA = { opt, pa };

      // Prefer exact Scenario match when provided
      if (expectedScenario && norm(opt.scenario) === expectedScenario) {
        chosenByScenario = opt;
        // keep scanning; chosenByScenario will be preferred below
      }
    }
  }

  const chosen = chosenByScenario ?? chosenByPA?.opt ?? null;
  if (chosen) {
    BEST_MEMO.set(mkey, chosen);
    return chosen;
  }
  return null;
}

/**──────────────────────────────────────────────────────────────────────────────
 * Public API: findAllMakeOptions
 * - depth === 0 (root): explore BUY vs MAKE for each direct input
 * - depth  >  0 with exploreAllChildScenarios = false: return ONE best option
 * - depth  >  0 with exploreAllChildScenarios = true: explore all scenarios with intelligent pruning
 *─────────────────────────────────────────────────────────────────────────────*/
export function findAllMakeOptions(
  materialTicker: string,
  recipeMap: RecipeMap,
  priceMap: PricesMap,
  exchange: Exchange,
  priceType: PriceType,
  bestMap: BestMap,
  depth = 0,
  exploreAllChildScenarios = false,
  honorRecipeIdFilter = false,
  forceMake?: Set<string>,
  forceBuy?: Set<string>
): MakeOption[] {
  // Optimized cache checking for children
  if (depth > 0) {
    if (exploreAllChildScenarios) {
      // Check full exploration cache
      const cacheKey = memoKey(exchange, priceType, materialTicker, forceMake, forceBuy);
      if (ALL_SCENARIOS_MEMO.has(cacheKey)) {
        return ALL_SCENARIOS_MEMO.get(cacheKey)!;
      }
    } else {
      // Not exploring all: check if bestMap has top3DisplayScenarios
      const bestEntry = (bestMap as any)?.[materialTicker];
      if (bestEntry && bestEntry.top3DisplayScenarios && bestEntry.top3DisplayScenarios.length > 0) {
        // Use top 3 display scenarios for better variety
        return topDisplayScenarioOptionsForTicker(
          materialTicker,
          recipeMap,
          priceMap,
          exchange,
          priceType,
          bestMap,
          honorRecipeIdFilter,
          undefined,
          forceMake,
          forceBuy
        );
      } else {
        // Fallback to single best (has its own BEST_MEMO cache)
        const best = bestOptionForTicker(
          materialTicker,
          recipeMap,
          priceMap,
          exchange,
          priceType,
          bestMap,
          honorRecipeIdFilter,
          undefined,
          forceMake,
          forceBuy
        );
        return best ? [best] : [];
      }
    }
  }

  // Rest of exploration logic...
  const results: MakeOption[] = [];
  const headers = recipeMap.headers;
  const rows = recipeMap.map[materialTicker] || [];

  const costCols = getCostColumnNames(exchange, priceType);
  const recipeIdIndex = headers.indexOf("RecipeID");
  const workforceCostIndex = headers.indexOf(costCols.wfCst);
  const depreciationCostIndex = headers.indexOf(costCols.deprec);
  const areaIndex = headers.indexOf("Area");
  const buildCostIndex = headers.indexOf(costCols.allBuildCst);
  const runsPerDayIndex = headers.indexOf("Runs P/D");
  const areaPerOutputIndex = headers.indexOf("AreaPerOutput");

  // If depth > 0 and exploreAllChildScenarios, respect bestMap recipeId filter (if enabled)
  let rowsToProcess = rows;
  if (depth > 0 && exploreAllChildScenarios && honorRecipeIdFilter) {
    const bestEntry = bestMap?.[materialTicker];
    const bestId = bestEntry?.recipeId;
    if (bestId) {
      const filtered = rows.filter((r) => String(r[recipeIdIndex] ?? "") === bestId);
      if (filtered.length > 0) rowsToProcess = filtered;
    }
  }

  for (const row of rowsToProcess) {
    const recipeId =
      recipeIdIndex !== -1 ? String(row[recipeIdIndex] ?? "") : null;

    const runsPerDayVal =
      runsPerDayIndex !== -1 ? Number(row[runsPerDayIndex] ?? 0) : 0;
    const areaVal = areaIndex !== -1 ? Number(row[areaIndex] ?? 0) : 0;
    const areaPerOutVal =
      areaPerOutputIndex !== -1
        ? Number(row[areaPerOutputIndex] ?? 0)
        : 0;

    const runsPerDay = runsPerDayVal > 0 ? runsPerDayVal : 1;
    const area = areaVal > 0 ? areaVal : 1;
    const areaPerOutput = areaPerOutVal > 0 ? areaPerOutVal : null;

    const workforceCost =
      workforceCostIndex !== -1 ? Number(row[workforceCostIndex] ?? 0) : 0;
    const depreciationCost =
      depreciationCostIndex !== -1
        ? Number(row[depreciationCostIndex] ?? 0)
        : 0;
    const totalProductionCostBase = workforceCost + depreciationCost;

    const buildCost =
      buildCostIndex !== -1 ? Number(row[buildCostIndex] ?? 0) : 0;

    // Inputs: collect and intelligently prune child options
    const inputs: Array<{
      ticker: string;
      amount: number;
      buyCost: number | null;
      childOptions: MakeOption[];
    }> = [];

    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Input${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Input${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const inputTicker = String(row[matIndex]);
        const inputAmount = Number(row[cntIndex] ?? 0);
        const inputPriceType = getInputPriceType(exchange, priceType);
        const inputPrice = findPrice(inputTicker, priceMap, exchange, inputPriceType);
        const buyCost = inputPrice != null ? inputAmount * inputPrice : null;

        // Recursively get child options (explore depths 0-2)
        let childOptions = findAllMakeOptions(
          inputTicker,
          recipeMap,
          priceMap,
          exchange,
          priceType,
          bestMap,
          depth + 1,
          depth <= 2 && exploreAllChildScenarios,
          honorRecipeIdFilter,
          forceMake,
          forceBuy
        );

        // Apply intelligent pruning based on depth
        if (depth === 0 && exploreAllChildScenarios) {
          // Root's direct children: keep diverse set (top 7 + one per simple scenario)
          childOptions = pruneForDiversity(childOptions, 7);
        } else if (depth === 1 && exploreAllChildScenarios) {
          // Children's children (grandchildren): aggressive pruning
          childOptions = pruneForDiversity(childOptions, 3);
        }
        
        inputs.push({ ticker: inputTicker, amount: inputAmount, buyCost, childOptions });
      }
    }

    // Apply cost-adaptive pruning before branching
    pruneByInputCostShare(inputs, depth, exploreAllChildScenarios);

    // Outputs (valuation on selected side for the root ticker)
    let totalOutputValue = 0;
    let byproductValue = 0;
    let output1Amount = 0;
    let output1HasPrice = false;

    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Output${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Output${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const outputTicker = String(row[matIndex]);
        const outputAmount = Number(row[cntIndex] ?? 0);
        const outputPrice = findPrice(outputTicker, priceMap, exchange, priceType);

        if (j === 0) {
          // Main ticker must have a price
          output1Amount = outputAmount;
          if (outputPrice) {
            output1HasPrice = true;
            const totalValue = outputAmount * outputPrice;
            totalOutputValue += totalValue;
          }
        } else {
          // Byproducts are optional
          if (outputPrice) {
            const totalValue = outputAmount * outputPrice;
            totalOutputValue += totalValue;
            byproductValue += totalValue;
          }
        }
      }
    }

    // Skip this recipe if the main output ticker doesn't have a price for the selected price mode
    if (!output1HasPrice) {
      continue;
    }

    // Build scenarios: each input → BUY or MAKE(all child options)
    type Scn = {
      scenarioName: string;
      totalInputCost: number;
      totalOpportunityCost: number;
      madeInputDetails: any[];
    };
    let scenarios: Scn[] = [
      {
        scenarioName: "",
        totalInputCost: 0,
        totalOpportunityCost: 0,
        madeInputDetails: [],
      },
    ];

    for (const input of inputs) {
      const branched: Scn[] = [];

      // Check force constraints
      const isForcedMake = forceMake && forceMake.has(input.ticker);
      const isForcedBuy = forceBuy && forceBuy.has(input.ticker);

      // BUY branch (skip if forced to make)
      if (input.buyCost != null && !isForcedMake) {
        for (const scn of scenarios) {
          const fullName = composeScenario(scn.scenarioName, {
            type: "BUY",
            inputTicker: input.ticker,
          });
          branched.push({
            scenarioName: fullName,
            totalInputCost: scn.totalInputCost + input.buyCost,
            totalOpportunityCost: scn.totalOpportunityCost,
            madeInputDetails: [
              ...scn.madeInputDetails,
              {
                recipeId: null,
                ticker: input.ticker,
                details: null,
                amountNeeded: input.amount,
                scenarioName: fullName,
                source: "BUY" as const,
                unitCost:
                  input.amount > 0 ? input.buyCost / input.amount : input.buyCost,
                totalCostPerBatch: input.buyCost,
                childScenario: null,
              },
            ],
          });
        }
      }

      // MAKE branch - iterate over ALL child options (skip if forced to buy)
      if (input.childOptions && input.childOptions.length > 0 && !isForcedBuy) {
        for (const childOpt of input.childOptions) {
          for (const scn of scenarios) {
            const fullName = composeScenario(scn.scenarioName, {
              type: "MAKE",
              inputTicker: input.ticker,
              recipeLabel: childOpt.recipeId ? childOpt.recipeId : childOpt.ticker,
              childScenario: childOpt.scenario || "",
            });
            branched.push({
              scenarioName: fullName,
              totalInputCost: scn.totalInputCost + childOpt.cogmPerOutput * input.amount,
              totalOpportunityCost:
                scn.totalOpportunityCost + childOpt.baseProfitPerOutput * input.amount,
              madeInputDetails: [
                ...scn.madeInputDetails,
                {
                  recipeId: childOpt.recipeId,
                  ticker: input.ticker,
                  details: childOpt,
                  amountNeeded: input.amount,
                  scenarioName: fullName,
                  source: "MAKE" as const,
                  unitCost: null,
                  totalCostPerBatch: childOpt.cogmPerOutput * input.amount,
                  childScenario: childOpt.scenario || null,
                },
              ],
            });
          }
        }
      }

      scenarios = branched;
    }

    // Convert to MakeOption(s)
    for (const scn of scenarios) {
      const totalInputCost = scn.totalInputCost;
      const totalProductionCost = totalInputCost + totalProductionCostBase;
      const baseProfit = totalOutputValue - totalProductionCost;
      const finalProfit = baseProfit - scn.totalOpportunityCost;

      const cogmPerOutput =
        output1Amount > 0
          ? (totalProductionCost - byproductValue) / output1Amount
          : 0;
      const baseProfitPerOutput =
        output1Amount > 0 ? baseProfit / output1Amount : 0;
      const adjProfitPerOutput =
        output1Amount > 0 ? finalProfit / output1Amount : 0;
      const valuePerOutput =
        output1Amount > 0 ? totalOutputValue / output1Amount : 0;

      const selfAreaPerDay =
        areaPerOutput && areaPerOutput > 0
          ? areaPerOutput
          : runsPerDay > 0 && output1Amount > 0
          ? area / (runsPerDay * output1Amount)
          : null;
      
      const inputBuffer7 =
  7 * ((totalInputCost + workforceCost) * runsPerDay);

      results.push({
        recipeId,
        ticker: materialTicker,
        scenario: scn.scenarioName,
        baseProfit,
        profit: finalProfit,
        cogmPerOutput,
        baseProfitPerOutput,
        adjProfitPerOutput,
        valuePerOutput,
        selfAreaPerDay,
        fullSelfAreaPerDay: area,
        profitPerDay: finalProfit * runsPerDay,
        baseProfitPerDay: baseProfit * runsPerDay,
        cost: totalInputCost,
        workforceCost,
        depreciationCost,
        totalOutputValue,
        byproductValue,
        totalOpportunityCost: scn.totalOpportunityCost,
        runsPerDay,
        area,
        buildCost,
        inputBuffer7,
        output1Amount,
        madeInputDetails: scn.madeInputDetails,
      });
    }
  } // ← This closes the "for (const row of rowsToProcess)" loop

  // Cache AFTER all rows processed, OUTSIDE the loop
  if (depth > 0 && results.length > 0 && exploreAllChildScenarios) {
    const cacheKey = memoKey(exchange, priceType, materialTicker, forceMake, forceBuy);
    ALL_SCENARIOS_MEMO.set(cacheKey, results);
  }

  return results;
}

export function buildScenarioRows(
  option: MakeOption,
  indentLevel: number,
  amountNeeded: number,
  showChildren: boolean
): ScenarioRowsResult {
  const demandUnitsPerDay =
    amountNeeded && amountNeeded > 0
      ? amountNeeded
      : (option.output1Amount || 0) * (option.runsPerDay || 0);

  const runsPerDayRequiredHere =
    option.output1Amount > 0 ? demandUnitsPerDay / option.output1Amount : 0;

  const stageProfitPerDay =
    option.baseProfitPerDay != null
      ? option.baseProfitPerDay
      : (option.baseProfitPerOutput || 0) *
        (option.output1Amount || 0) *
        (option.runsPerDay || 0);

  const adjStageProfitPerDay =
    option.profitPerDay != null
      ? option.profitPerDay
      : (option.adjProfitPerOutput || 0) *
        (option.output1Amount || 0) *
        (option.runsPerDay || 0);

  const areaPerOutput = option.selfAreaPerDay != null ? option.selfAreaPerDay : 0;
  const scaledSelfAreaNeeded = areaPerOutput * demandUnitsPerDay;
  const fullSelfAreaPerDay =
    option.fullSelfAreaPerDay != null ? option.fullSelfAreaPerDay : option.area || 0;
  const selfAreaDisplay = indentLevel === 0 ? fullSelfAreaPerDay : scaledSelfAreaNeeded;

  // Children
  const allChildren = (option.madeInputDetails || []).filter((x) => x && x.details);
  const childCalcs: ScenarioRowsResult[] = [];
  let childrenAreaNeededSum = 0;
  let childrenBuildCostNeededSum = 0;
  let childrenInputBuffer7NeededSum = 0;

  for (const item of allChildren) {
    const childDemandPerDay = (item.amountNeeded || 0) * runsPerDayRequiredHere;
    const child = buildScenarioRows(
      item.details!,
      indentLevel + 1,
      childDemandPerDay,
      showChildren
    );
    childCalcs.push(child);
    childrenAreaNeededSum += child.subtreeAreaNeededPerDay || 0;
    childrenBuildCostNeededSum += child.subtreeBuildCostNeeded || 0;
    childrenInputBuffer7NeededSum += child.subtreeInputBuffer7Needed || 0;

    // Store the calculated scaling values on the input detail
    item.childRunsPerDayRequired = child.runsPerDayRequired;
    item.childDemandUnitsPerDay = child.demandUnitsPerDay;
  }


  const childrenAreaAtCapacity =
    runsPerDayRequiredHere > 0
      ? (childrenAreaNeededSum / runsPerDayRequiredHere) * (option.runsPerDay || 0)
      : 0;

  const totalAreaForOwnDenominator = fullSelfAreaPerDay + childrenAreaAtCapacity;
  const totalAreaNeededForParent = scaledSelfAreaNeeded + childrenAreaNeededSum;

  // Build cost calculations (parallel to area)
  const selfBuildCost = option.buildCost || 0;
  const scaledSelfBuildCostNeeded = selfBuildCost * (runsPerDayRequiredHere / (option.runsPerDay || 1));

  const childrenBuildCostAtCapacity =
    runsPerDayRequiredHere > 0
      ? (childrenBuildCostNeededSum / runsPerDayRequiredHere) * (option.runsPerDay || 0)
      : 0;

  const totalBuildCostForOwn = selfBuildCost + childrenBuildCostAtCapacity;
  const totalBuildCostNeededForParent = scaledSelfBuildCostNeeded + childrenBuildCostNeededSum;

  // Input buffer calculations (parallel to area and build cost)
  const selfInputBuffer7 = option.inputBuffer7 || 0;
  const scaledSelfInputBuffer7Needed = selfInputBuffer7 * (runsPerDayRequiredHere / (option.runsPerDay || 1));

  const childrenInputBuffer7AtCapacity =
    runsPerDayRequiredHere > 0
      ? (childrenInputBuffer7NeededSum / runsPerDayRequiredHere) * (option.runsPerDay || 0)
      : 0;

  const totalInputBuffer7ForOwn = selfInputBuffer7 + childrenInputBuffer7AtCapacity;
  const totalInputBuffer7NeededForParent = scaledSelfInputBuffer7Needed + childrenInputBuffer7NeededSum;

  const totalProfitPA =
    totalAreaForOwnDenominator > 0
      ? stageProfitPerDay / totalAreaForOwnDenominator
      : 0;

  (option as any).totalProfitPA = totalProfitPA;

  return {
    subtreeAreaPerDay: totalAreaForOwnDenominator,
    subtreeAreaNeededPerDay: totalAreaNeededForParent,
    subtreeProfitPerArea: totalProfitPA,
    subtreeBuildCost: totalBuildCostForOwn,
    subtreeBuildCostNeeded: totalBuildCostNeededForParent,
    subtreeInputBuffer7: totalInputBuffer7ForOwn,
    subtreeInputBuffer7Needed: totalInputBuffer7NeededForParent,
    runsPerDayRequired: runsPerDayRequiredHere,
    demandUnitsPerDay: demandUnitsPerDay,
  };
}
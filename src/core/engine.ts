// src/core/engine.ts
import {
  BestMap,
  MakeOption,
  PriceMode,
  PricesMap,
  RecipeMap,
  ScenarioRowsResult,
} from "../types";
import { findPrice } from "./price";
import { composeScenario } from "./scenario";

/**──────────────────────────────────────────────────────────────────────────────
 * Child “best option” memo (keyed by priceMode+ticker) to avoid recomputation
 *─────────────────────────────────────────────────────────────────────────────*/
const BEST_MEMO = new Map<string, MakeOption>();
const memoKey = (mode: PriceMode, ticker: string) => `${mode}::${ticker}`;

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Build the single best option for a ticker (used for children/grandchildren).
 * Selection logic:
 *   1) Build scenarios for THIS ticker only (each input → BUY or MAKE(childBest)).
 *   2) If bestMap has a Scenario string for this ticker, select the option whose
 *      `scenario` matches that string exactly (after normalization).
 *   3) Otherwise (no Scenario in bestMap or no exact match), fall back to the
 *      option with the highest Profit/Area at this ticker’s capacity.
 * Also honors bestMap.recipeId by filtering candidate recipes to that ID.
 */
function bestOptionForTicker(
  materialTicker: string,
  recipeMap: RecipeMap,
  priceMap: PricesMap,
  priceMode: PriceMode,
  bestMap: BestMap,
  seen: Set<string> = new Set()
): MakeOption | null {
  const mkey = memoKey(priceMode, materialTicker);
  if (BEST_MEMO.has(mkey)) return deepClone(BEST_MEMO.get(mkey)!);

  // guard against cycles
  if (seen.has(materialTicker)) return null;
  const nextSeen = new Set(seen);
  nextSeen.add(materialTicker);

  const headers = recipeMap.headers;
  const rows = recipeMap.map[materialTicker] || [];
  if (!rows.length) return null;

  const idx = {
    recipeId: headers.indexOf("RecipeID"),
    wf: headers.indexOf("WfCst"),
    dep: headers.indexOf("Deprec"),
    area: headers.indexOf("Area"),
    build: headers.indexOf("AllBuildCst"),
    runs: headers.indexOf("Runs P/D"),
    areaPerOut: headers.indexOf("AreaPerOutput"),
  };

  const bestEntry = bestMap?.[materialTicker] ?? null;
  const bestId = bestEntry?.recipeId ?? null;
  const expectedScenario = norm((bestEntry?.scenario ?? ""));

  // If bestMap gives a recipeId, only consider that recipe; fallback to all if none match
  const rowsToUse0 = bestId
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
        const ask = findPrice(inputTicker, priceMap, "ask");
        const buyCost = ask != null ? inputAmount * ask : null;
        const childBest = bestOptionForTicker(
          inputTicker,
          recipeMap,
          priceMap,
          priceMode,
          bestMap,
          nextSeen
        );
        inputs.push({ ticker: inputTicker, amount: inputAmount, buyCost, childBest });
      }
    }

    // Outputs (valuation on selected side for this ticker)
    let totalOutputValue = 0;
    let byproductValue = 0;
    let output1Amount = 0;
    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Output${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Output${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const outTicker = String(row[matIndex]);
        const outAmt = Number(row[cntIndex] ?? 0);
        const outPrice = findPrice(outTicker, priceMap, priceMode);
        if (!outPrice) continue;
        const totalVal = outAmt * outPrice;
        totalOutputValue += totalVal;
        if (j === 0) output1Amount = outAmt;
        else byproductValue += totalVal;
      }
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

      // BUY branch
      if (input.buyCost != null) {
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
              },
            ],
          });
        }
      }

      // MAKE branch (single best child only, if available)
      if (input.childBest) {
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
    return deepClone(chosen);
  }
  return null;
}

/**──────────────────────────────────────────────────────────────────────────────
 * Public API: findAllMakeOptions
 * - depth === 0 (root): explore BUY vs MAKE(childBest) for each direct input.
 * - depth  >  0       : return exactly ONE option = child's best scenario.
 *─────────────────────────────────────────────────────────────────────────────*/
export function findAllMakeOptions(
  materialTicker: string,
  recipeMap: RecipeMap,
  priceMap: PricesMap,
  priceMode: PriceMode,
  bestMap: BestMap,
  depth = 0
): MakeOption[] {
  if (depth > 0) {
    const best = bestOptionForTicker(
      materialTicker,
      recipeMap,
      priceMap,
      priceMode,
      bestMap
    );
    return best ? [best] : [];
  }

  // Root exploration (BUY vs MAKE(childBest) per input)
  const results: MakeOption[] = [];
  const headers = recipeMap.headers;
  const rows = recipeMap.map[materialTicker] || [];

  const recipeIdIndex = headers.indexOf("RecipeID");
  const workforceCostIndex = headers.indexOf("WfCst");
  const depreciationCostIndex = headers.indexOf("Deprec");
  const areaIndex = headers.indexOf("Area");
  const buildCostIndex = headers.indexOf("AllBuildCst");
  const runsPerDayIndex = headers.indexOf("Runs P/D");
  const areaPerOutputIndex = headers.indexOf("AreaPerOutput");

  for (const row of rows) {
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

    // Inputs at root: BUY(ask) vs MAKE(childBest) only
    const inputs: Array<{
      ticker: string;
      amount: number;
      buyCost: number | null;
      childBest: MakeOption | null;
    }> = [];

    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Input${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Input${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const inputTicker = String(row[matIndex]);
        const inputAmount = Number(row[cntIndex] ?? 0);
        const ask = findPrice(inputTicker, priceMap, "ask");
        const buyCost = ask != null ? inputAmount * ask : null;
        const childBest = bestOptionForTicker(
          inputTicker,
          recipeMap,
          priceMap,
          priceMode,
          bestMap
        );
        inputs.push({ ticker: inputTicker, amount: inputAmount, buyCost, childBest });
      }
    }

    // Outputs (valuation on selected side for the root ticker)
    let totalOutputValue = 0;
    let byproductValue = 0;
    let output1Amount = 0;

    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Output${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Output${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const outputTicker = String(row[matIndex]);
        const outputAmount = Number(row[cntIndex] ?? 0);
        const outputPrice = findPrice(outputTicker, priceMap, priceMode);
        if (!outputPrice) continue;

        const totalValue = outputAmount * outputPrice;
        totalOutputValue += totalValue;

        if (j === 0) output1Amount = outputAmount;
        else byproductValue += totalValue;
      }
    }

    // Root scenarios: each input → BUY or MAKE(childBest)
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

      // BUY
      if (input.buyCost != null) {
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
              },
            ],
          });
        }
      }

      // MAKE(childBest)
      if (input.childBest) {
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
              },
            ],
          });
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
        output1Amount,
        madeInputDetails: scn.madeInputDetails,
      });
    }
  }

  return results;
}

export function buildScenarioRows(
  option: MakeOption,
  indentLevel: number,
  amountNeeded: number,
  showChildren: boolean
): ScenarioRowsResult {
  const rows: [string, number | string][] = [];
  const indentStr = "  ".repeat(indentLevel);

  const demandUnitsPerDay =
    amountNeeded && amountNeeded > 0
      ? amountNeeded
      : (option.output1Amount || 0) * (option.runsPerDay || 0);

  const runsPerDayRequiredHere =
    option.output1Amount > 0 ? demandUnitsPerDay / option.output1Amount : 0;

  if (indentLevel > 0) {
    rows.push([
      `${indentStr}(Scaled to ${runsPerDayRequiredHere.toFixed(
        2
      )} run(s)/day for demand of ${demandUnitsPerDay.toFixed(2)})`,
      "",
    ]);
  }

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
  }

  if (showChildren) {
    childCalcs.forEach((child) => rows.push(...child.rows));
  } else if (childCalcs.length > 0) {
    const bestChild = childCalcs.reduce(
      (best, cur) =>
        (cur.subtreeProfitPerArea || -Infinity) >
        ((best?.subtreeProfitPerArea as number) ?? -Infinity)
          ? cur
          : best,
      null as any
    );
    if (bestChild) rows.push(...bestChild.rows);
  }

  const childrenAreaAtCapacity =
    runsPerDayRequiredHere > 0
      ? (childrenAreaNeededSum / runsPerDayRequiredHere) * (option.runsPerDay || 0)
      : 0;

  const totalAreaForOwnDenominator = fullSelfAreaPerDay + childrenAreaAtCapacity;
  const totalAreaNeededForParent = scaledSelfAreaNeeded + childrenAreaNeededSum;

  const totalProfitPA =
    totalAreaForOwnDenominator > 0
      ? stageProfitPerDay / totalAreaForOwnDenominator
      : 0;

  (option as any).totalProfitPA = totalProfitPA;

  rows.unshift([`${indentStr}Total Profit P/A:`, totalProfitPA || 0]);
  rows.push([`${indentStr}RecipeID:`, option.recipeId || ""]);
  rows.push([`${indentStr}Sourcing Scenario:`, option.scenario || ""]);
  rows.push([`${indentStr}Stage Profit / Day:`, stageProfitPerDay || 0]);
  rows.push([`${indentStr}Adj. Stage Profit / Day:`, adjStageProfitPerDay || 0]);
  rows.push([`${indentStr}Adjusted Area (per day):`, selfAreaDisplay || 0]);
  rows.push([`${indentStr}Total Area (per day):`, totalAreaForOwnDenominator || 0]);

  return {
    rows,
    subtreeAreaPerDay: totalAreaForOwnDenominator,
    subtreeAreaNeededPerDay: totalAreaNeededForParent,
    subtreeProfitPerArea: totalProfitPA,
  };
}

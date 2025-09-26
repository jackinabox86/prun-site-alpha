import { BestMap, MakeOption, PriceMode, PricesMap, RecipeMap, ScenarioRowsResult } from "../types";
import { findPrice } from "./price";

// Stage 1: keep pure / stateless (no Apps Script caches here)

export function findAllMakeOptions(
  materialTicker: string,
  recipeMap: RecipeMap,
  priceMap: PricesMap,
  priceMode: PriceMode,
  bestMap?: BestMap | null,
  depth = 0
): MakeOption[] {
  if (depth > 5) return [];

  const results: MakeOption[] = [];
  const headers = recipeMap.headers;
  const rows = recipeMap.map[materialTicker] || [];

  const recipeIdIndex       = headers.indexOf("RecipeID");
  const workforceCostIndex  = headers.indexOf("WfCst");
  const depreciationCostIndex = headers.indexOf("Deprec");
  const areaIndex           = headers.indexOf("Area");
  const buildCostIndex      = headers.indexOf("AllBuildCst");
  const runsPerDayIndex     = headers.indexOf("Runs P/D");
  const areaPerOutputIndex  = headers.indexOf("AreaPerOutput");

  for (const row of rows) {
    const recipeId = recipeIdIndex !== -1 ? String(row[recipeIdIndex] ?? "") : null;

    // Prune children to "best" when descending (matches your Apps Script)
    if (bestMap && depth > 0) {
      const bestId = bestMap[materialTicker];
      if (bestId && recipeId !== bestId) continue;
    }

    // Safely coerce numbers
    const runsPerDayVal   = runsPerDayIndex     !== -1 ? Number(row[runsPerDayIndex]    ?? 0) : 0;
    const areaVal         = areaIndex           !== -1 ? Number(row[areaIndex]          ?? 0) : 0;
    const areaPerOutVal   = areaPerOutputIndex  !== -1 ? Number(row[areaPerOutputIndex] ?? 0) : 0;

    const runsPerDay      = runsPerDayVal > 0 ? runsPerDayVal : 1;
    const area            = areaVal       > 0 ? areaVal       : 1;
    const areaPerOutput   = areaPerOutVal > 0 ? areaPerOutVal : null;

    const workforceCost   = workforceCostIndex    !== -1 ? Number(row[workforceCostIndex]    ?? 0) : 0;
    const depreciationCost= depreciationCostIndex !== -1 ? Number(row[depreciationCostIndex] ?? 0) : 0;
    const totalProductionCostBase = (Number.isFinite(workforceCost) ? workforceCost : 0)
                                  + (Number.isFinite(depreciationCost) ? depreciationCost : 0);

    const buildCost       = buildCostIndex !== -1 ? Number(row[buildCostIndex] ?? 0) : 0;

    // ---- INPUTS ----
    const inputs: Array<{
      ticker: string;
      amount: number;
      buyCost: number | null;
      makeOptions: MakeOption[];
    }> = [];

    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Input${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Input${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const inputTicker = String(row[matIndex]);            // ticker cell
        const inputAmount = Number(row[cntIndex] ?? 0);       // quantity
        const unitPrice   = findPrice(inputTicker, priceMap, priceMode);
        const makeOptions = findAllMakeOptions(inputTicker, recipeMap, priceMap, priceMode, bestMap, depth + 1);

        inputs.push({
          ticker: inputTicker,
          amount: inputAmount,
          buyCost: unitPrice != null ? inputAmount * unitPrice : null,
          makeOptions
        });
      }
    }

    // ---- OUTPUTS ----
    let totalOutputValue = 0;
    let byproductValue = 0;
    let output1Amount = 0;

    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Output${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Output${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const outputTicker = String(row[matIndex]);
        const outputAmount = Number(row[cntIndex] ?? 0);
        const outputPrice  = findPrice(outputTicker, priceMap, "bid"); // keep P&L on bid
        if (!outputPrice) continue;

        const totalValue = outputAmount * outputPrice;
        totalOutputValue += totalValue;

        if (j === 0) output1Amount = outputAmount;
        else byproductValue += totalValue;
      }
    }

    // ---- SCENARIO EXPANSION ----
    let scenarios = [{
      scenarioName: "",
      totalInputCost: 0,
      totalOpportunityCost: 0,
      madeInputDetails: [] as any[]
    }];

    inputs.forEach(input => {
      const newScenarios: typeof scenarios = [];

      // BUY branch
      if (input.buyCost !== null) {
        const buyCost = input.buyCost;
        scenarios.forEach(scn => {
          const branchName = `Buy ${input.ticker}`;
          const fullName = scn.scenarioName ? `${scn.scenarioName}, ${branchName}` : branchName;

          newScenarios.push({
            scenarioName: fullName,
            totalInputCost: scn.totalInputCost + buyCost,
            totalOpportunityCost: scn.totalOpportunityCost,
            madeInputDetails: [
              ...scn.madeInputDetails,
              {
                recipeId: null,
                ticker: input.ticker,
                details: null,
                amountNeeded: input.amount,
                scenarioName: branchName
              }
            ]
          });
        });
      }

      // MAKE branches
      if (input.makeOptions && input.makeOptions.length > 0) {
        input.makeOptions.forEach(mo => {
          scenarios.forEach(scn => {
            const childScenarioName = mo.scenario || "";
            const recipeLabel = mo.recipeId ? mo.recipeId : mo.ticker;
            const branchName = `Make ${recipeLabel} (for ${input.ticker})`;
            const fullName = scn.scenarioName
              ? `${scn.scenarioName}, ${branchName}${childScenarioName ? " [" + childScenarioName + "]" : ""}`
              : `${branchName}${childScenarioName ? " [" + childScenarioName + "]" : ""}`;

            newScenarios.push({
              scenarioName: fullName,
              totalInputCost: scn.totalInputCost + mo.cogmPerOutput * input.amount,
              totalOpportunityCost: scn.totalOpportunityCost + (mo.baseProfitPerOutput * input.amount),
              madeInputDetails: [
                ...scn.madeInputDetails,
                {
                  recipeId: mo.recipeId,
                  ticker: input.ticker,
                  details: mo,
                  amountNeeded: input.amount,
                  scenarioName: branchName + (childScenarioName ? " [" + childScenarioName + "]" : "")
                }
              ]
            });
          });
        });
      }

      scenarios = newScenarios;
    });

    // ---- METRICS -> MakeOption(s) ----
    scenarios.forEach(scn => {
      const totalInputCost = scn.totalInputCost;
      const totalProductionCost = totalInputCost + totalProductionCostBase;
      const baseProfit = totalOutputValue - totalProductionCost;
      const finalProfit = baseProfit - scn.totalOpportunityCost;

      const cogmPerOutput =
        (output1Amount > 0) ? (totalProductionCost - byproductValue) / output1Amount : 0;
      const baseProfitPerOutput =
        (output1Amount > 0) ? baseProfit / output1Amount : 0;
      const adjProfitPerOutput =
        (output1Amount > 0) ? finalProfit / output1Amount : 0;
      const valuePerOutput =
        (output1Amount > 0) ? totalOutputValue / output1Amount : 0;

      const selfAreaPerDay =
        (areaPerOutput && areaPerOutput > 0) ? areaPerOutput :
        (runsPerDay > 0 && output1Amount > 0) ? area / (runsPerDay * output1Amount) : null;

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
        madeInputDetails: scn.madeInputDetails
      });
    });
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
      : ((option.output1Amount || 0) * (option.runsPerDay || 0));

  const runsPerDayRequiredHere =
    (option.output1Amount > 0) ? (demandUnitsPerDay / option.output1Amount) : 0;

  if (indentLevel > 0) {
    rows.push([`${indentStr}(Scaled to ${runsPerDayRequiredHere.toFixed(2)} run(s)/day for demand of ${demandUnitsPerDay.toFixed(2)})`, ""]);
  }

  const stageProfitPerDay =
    (option.baseProfitPerDay != null)
      ? option.baseProfitPerDay
      : ((option.baseProfitPerOutput || 0) * (option.output1Amount || 0) * (option.runsPerDay || 0));

  const adjStageProfitPerDay =
    (option.profitPerDay != null)
      ? option.profitPerDay
      : ((option.adjProfitPerOutput || 0) * (option.output1Amount || 0) * (option.runsPerDay || 0));

  const areaPerOutput = (option.selfAreaPerDay != null) ? option.selfAreaPerDay : 0;
  const scaledSelfAreaNeeded = areaPerOutput * demandUnitsPerDay;
  const fullSelfAreaPerDay = (option.fullSelfAreaPerDay != null) ? option.fullSelfAreaPerDay : (option.area || 0);
  const selfAreaDisplay = (indentLevel === 0) ? fullSelfAreaPerDay : scaledSelfAreaNeeded;

  // Children
  const allChildren = (option.madeInputDetails || []).filter(x => x && x.details);
  const childCalcs: ScenarioRowsResult[] = [];
  let childrenAreaNeededSum = 0;

  for (const item of allChildren) {
    const childDemandPerDay = (item.amountNeeded || 0) * runsPerDayRequiredHere;
    const child = buildScenarioRows(item.details!, indentLevel + 1, childDemandPerDay, showChildren);
    childCalcs.push(child);
    childrenAreaNeededSum += (child.subtreeAreaNeededPerDay || 0);
  }

  if (showChildren) {
    childCalcs.forEach(child => rows.push(...child.rows));
  } else if (childCalcs.length > 0) {
    const bestChild = childCalcs.reduce((best, cur) =>
      ((cur.subtreeProfitPerArea || -Infinity) > ((best?.subtreeProfitPerArea) ?? -Infinity)) ? cur : best, null as any);
    if (bestChild) rows.push(...bestChild.rows);
  }

  const childrenAreaAtCapacity =
    (runsPerDayRequiredHere > 0)
      ? (childrenAreaNeededSum / runsPerDayRequiredHere) * (option.runsPerDay || 0)
      : 0;

  const totalAreaForOwnDenominator = fullSelfAreaPerDay + childrenAreaAtCapacity;
  const totalAreaNeededForParent  = scaledSelfAreaNeeded + childrenAreaNeededSum;

  const totalProfitPA = (totalAreaForOwnDenominator > 0)
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
    subtreeProfitPerArea: totalProfitPA
  };
}

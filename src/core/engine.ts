import { BestMap, MakeOption, PriceMode, PricesMap, RecipeMap, ScenarioRowsResult } from "../types";
import { findPrice } from "./price";

// NOTE: In Stage 1 we do *not* port the Apps Script scenarioCache or PropertiesService.
// Keep this pure. You can add an in-memory cache object if needed later (Stage 2/3).

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

  const recipeIdIndex = headers.indexOf("RecipeID");
  const workforceCostIndex = headers.indexOf("WfCst");
  const depreciationCostIndex = headers.indexOf("Deprec");
  const areaIndex = headers.indexOf("Area");
  const buildCostIndex = headers.indexOf("AllBuildCst");
  const runsPerDayIndex = headers.indexOf("Runs P/D");
  const areaPerOutputIndex = headers.indexOf("AreaPerOutput");

  for (const row of rows) {
    const recipeId = row[recipeIdIndex];

    // If we decide to prune children by bestMap (like your GS code)
    if (bestMap && depth > 0) {
      const bestId = bestMap[materialTicker];
      if (bestId && recipeId !== bestId) continue;
    }

    const runsPerDay = (runsPerDayIndex !== -1 && row[runsPerDayIndex] > 0) ? row[runsPerDayIndex] : 1;
    const area = (areaIndex !== -1 && row[areaIndex] > 0) ? row[areaIndex] : 1;
    const areaPerOutput = (areaPerOutputIndex !== -1 && row[areaPerOutputIndex] > 0) ? row[areaPerOutputIndex] : null;

    const workforceCost = parseFloat(row[workforceCostIndex]) || 0;
    const depreciationCost = parseFloat(row[depreciationCostIndex]) || 0;
    const totalProductionCostBase = workforceCost + depreciationCost;
    const buildCost = (buildCostIndex !== -1) ? row[buildCostIndex] : 0;

    // Inputs
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
        const inputTicker = row[matIndex];
        const inputAmount = row[cntIndex];
        const unitPrice = findPrice(inputTicker, priceMap, priceMode);
        const makeOptions = findAllMakeOptions(inputTicker, recipeMap, priceMap, priceMode, bestMap, depth + 1);
        inputs.push({
          ticker: inputTicker,
          amount: inputAmount,
          buyCost: unitPrice != null ? inputAmount * unitPrice : null,
          makeOptions
        });
      }
    }

    // Outputs
    let totalOutputValue = 0, byproductValue = 0, output1Amount = 0;
    for (let j = 0; j < 10; j++) {
      const matIndex = headers.indexOf(`Output${j + 1}MAT`);
      const cntIndex = headers.indexOf(`Output${j + 1}CNT`);
      if (matIndex !== -1 && row[matIndex]) {
        const outputTicker = row[matIndex];
        const outputAmount = row[cntIndex];
        const outputPrice = findPrice(outputTicker, priceMap, "bid"); // keep P&L on bid like your current logic
        if (!outputPrice) continue;
        const totalValue = outputAmount * outputPrice;
        totalOutputValue += totalValue;
        if (j === 0) output1Amount = outputAmount;
        else byproductValue += totalValue;
      }
    }

    // Scenario expansion
    let scenarios = [{
      scenarioName: "",
      totalInputCost: 0,
      totalOpportunityCost: 0,
      madeInputDetails: [] as any[]
    }];

    inputs.forEach(input => {
      const newScenarios: typeof scenarios = [];

      // BUY branch — only if ask price exists
if (input.buyCost !== null) {
  const buyCost: number = input.buyCost; // helps TS narrow
  scenarios.forEach((scn) => {
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
          scenarioName: branchName,
        },
      ],
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
              madeInputDetails: [...scn.madeInputDetails, {
                recipeId: mo.recipeId,
                ticker: input.ticker,
                details: mo,
                amountNeeded: input.amount,
                scenarioName: branchName + (childScenarioName ? " [" + childScenarioName + "]" : "")
              }]
            });
          });
        });
      }

      scenarios = newScenarios;
    });

    // Metrics → MakeOption(s)
    scenarios.forEach(scn => {
      const totalInputCost = scn.totalInputCost;
      const totalProductionCost = totalInputCost + totalProductionCostBase;
      const baseProfit = totalOutputValue - totalProductionCost;
      const finalProfit = baseProfit - scn.totalOpportunityCost;

      const cogmPerOutput = (output1Amount > 0) ? (totalProductionCost - byproductValue) / output1Amount : 0;
      const baseProfitPerOutput = (output1Amount > 0) ? baseProfit / output1Amount : 0;
      const adjProfitPerOutput = (output1Amount > 0) ? finalProfit / output1Amount : 0;
      const valuePerOutput = (output1Amount > 0) ? totalOutputValue / output1Amount : 0;

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


#!/usr/bin/env tsx
/**
 * Test script to verify buy/make scenario calculations for specific tickers.
 * Walks the production chain tree, printing intermediate calculation values
 * and comparing them to buildScenarioRows output.
 *
 * Usage: npx tsx scripts/test-scenario-analysis.ts
 */

import { loadAllFromCsv } from "../src/lib/loadFromCsv";
import { findAllMakeOptions, buildScenarioRows, clearScenarioCache } from "../src/core/engine";
import { LOCAL_DATA_SOURCES } from "../src/lib/config";
import type { MakeOption, ScenarioRowsResult, BestMap } from "../src/types";

const TICKERS = ["KOM", "BCO"];
const EXCHANGE = "ANT" as const;
const PRICE_TYPE = "bid" as const;

const fmt = (n: number | null | undefined, decimals = 4): string => {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toFixed(decimals);
};

const fmtMoney = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toFixed(2);
};

const TOLERANCE = 0.0001;
function check(label: string, local: number, engine: number, prefix: string): boolean {
  const match = Math.abs(local - engine) < TOLERANCE;
  const tag = match ? "PASS" : "FAIL";
  console.log(`${prefix}CHECK: ${label}: local=${fmt(local)} vs engine=${fmt(engine)} -> ${tag}`);
  if (!match) {
    console.log(`${prefix}  *** MISMATCH DETECTED ***`);
  }
  return match;
}

function printScenarioTrace(
  option: MakeOption,
  indentLevel: number,
  amountNeeded: number
): { childrenAreaNeededSum: number; result: ScenarioRowsResult } {
  const prefix = "  ".repeat(indentLevel);

  // Replicate engine.ts lines 1308-1397
  const demandUnitsPerDay =
    amountNeeded > 0
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

  const areaPerOutput = option.selfAreaPerDay ?? 0;
  const scaledSelfAreaNeeded = areaPerOutput * demandUnitsPerDay;
  const fullSelfAreaPerDay = option.fullSelfAreaPerDay ?? option.area ?? 0;
  const selfAreaDisplay = indentLevel === 0 ? fullSelfAreaPerDay : scaledSelfAreaNeeded;

  // Header
  console.log(`${prefix}`);
  console.log(`${prefix}[LEVEL ${indentLevel}] ${option.ticker}  |  Recipe: ${option.recipeId}  |  Building: ${option.building}`);
  if (indentLevel === 0) {
    console.log(`${prefix}  Scenario: ${option.scenario}`);
  }

  // Inputs
  const allInputs = option.madeInputDetails || [];
  console.log(`${prefix}  ---- INPUTS ----`);
  for (const inp of allInputs) {
    if (inp.source === "BUY") {
      console.log(`${prefix}    ${inp.ticker.padEnd(8)} x${inp.amountNeeded}   BUY   @ ${fmtMoney(inp.unitCost)}/unit   = ${fmtMoney(inp.totalCostPerBatch)}/batch`);
    } else {
      console.log(`${prefix}    ${inp.ticker.padEnd(8)} x${inp.amountNeeded}   MAKE  (via ${inp.recipeId ?? inp.ticker}${inp.childScenario ? ` [${inp.childScenario}]` : ""})`);
    }
  }

  // Production
  console.log(`${prefix}  ---- PRODUCTION ----`);
  console.log(`${prefix}    output1Amount:          ${option.output1Amount}`);
  console.log(`${prefix}    runsPerDay:             ${fmt(option.runsPerDay)}`);
  console.log(`${prefix}    capacity (output/day):  ${fmt(option.output1Amount * option.runsPerDay)}`);
  console.log(`${prefix}    demandUnitsPerDay:      ${fmt(demandUnitsPerDay)}`);
  console.log(`${prefix}    runsPerDayRequired:     ${fmt(runsPerDayRequiredHere)}`);

  // Cost/Profit
  console.log(`${prefix}  ---- COST / PROFIT ----`);
  console.log(`${prefix}    cost (inputs/batch):    ${fmtMoney(option.cost)}`);
  console.log(`${prefix}    workforceCost:          ${fmtMoney(option.workforceCost)}`);
  console.log(`${prefix}    depreciationCost:       ${fmtMoney(option.depreciationCost)}`);
  console.log(`${prefix}    buildCost:              ${fmtMoney(option.buildCost)}`);
  console.log(`${prefix}    totalOutputValue:       ${fmtMoney(option.totalOutputValue)}`);
  console.log(`${prefix}    byproductValue:         ${fmtMoney(option.byproductValue)}`);
  console.log(`${prefix}    baseProfit (per batch): ${fmtMoney(option.baseProfit)}`);
  console.log(`${prefix}    baseProfitPerDay:       ${fmtMoney(option.baseProfitPerDay)}`);
  console.log(`${prefix}    profitPerDay (adj):     ${fmtMoney(option.profitPerDay)}`);
  console.log(`${prefix}    oppCost:                ${fmtMoney(option.totalOpportunityCost)}`);
  console.log(`${prefix}    stageProfitPerDay:      ${fmtMoney(stageProfitPerDay)}`);

  // Recurse into MAKE children and sum area
  const madeChildren = allInputs.filter((x) => x.source === "MAKE" && x.details);
  let childrenAreaNeededSum = 0;
  let childrenBuildCostNeededSum = 0;
  let childrenInputBuffer7NeededSum = 0;

  for (const item of madeChildren) {
    const childDemandPerDay = (item.amountNeeded || 0) * runsPerDayRequiredHere;
    console.log(`${prefix}`);
    console.log(`${prefix}  +-- MAKE child: ${item.ticker} x${item.amountNeeded}/batch -> demand=${fmt(childDemandPerDay)} units/day`);

    const childResult = printScenarioTrace(item.details!, indentLevel + 1, childDemandPerDay);
    childrenAreaNeededSum += childResult.result.subtreeAreaNeededPerDay || 0;
    childrenBuildCostNeededSum += childResult.result.subtreeBuildCostNeeded || 0;
    childrenInputBuffer7NeededSum += childResult.result.subtreeInputBuffer7Needed || 0;
  }

  // Area chain
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

  console.log(`${prefix}  ---- AREA CHAIN ----`);
  console.log(`${prefix}    selfAreaPerDay (per-unit):      ${fmt(areaPerOutput)}`);
  console.log(`${prefix}    fullSelfAreaPerDay (building):   ${fmt(fullSelfAreaPerDay)}`);
  console.log(`${prefix}    scaledSelfAreaNeeded:            ${fmt(scaledSelfAreaNeeded)}  (= ${fmt(areaPerOutput)} * ${fmt(demandUnitsPerDay)})`);
  console.log(`${prefix}    selfAreaDisplay:                 ${fmt(selfAreaDisplay)}  (level=${indentLevel})`);
  console.log(`${prefix}    childrenAreaNeededSum:           ${fmt(childrenAreaNeededSum)}  (sum of ${madeChildren.length} MAKE children's subtreeAreaNeededPerDay)`);
  console.log(`${prefix}    childrenAreaAtCapacity:          ${fmt(childrenAreaAtCapacity)}  (= ${fmt(childrenAreaNeededSum)} / ${fmt(runsPerDayRequiredHere)} * ${fmt(option.runsPerDay)})`);
  console.log(`${prefix}    totalAreaForOwnDenominator:      ${fmt(totalAreaForOwnDenominator)}  (= ${fmt(fullSelfAreaPerDay)} + ${fmt(childrenAreaAtCapacity)})`);
  console.log(`${prefix}    totalAreaNeededForParent:        ${fmt(totalAreaNeededForParent)}  (= ${fmt(scaledSelfAreaNeeded)} + ${fmt(childrenAreaNeededSum)})`);
  console.log(`${prefix}    totalProfitPA:                   ${fmt(totalProfitPA)}  (= ${fmtMoney(stageProfitPerDay)} / ${fmt(totalAreaForOwnDenominator)})`);

  // Official buildScenarioRows result
  const officialResult = buildScenarioRows(option, indentLevel, amountNeeded, false);

  console.log(`${prefix}  ---- buildScenarioRows RESULT ----`);
  console.log(`${prefix}    subtreeAreaPerDay:        ${fmt(officialResult.subtreeAreaPerDay)}`);
  console.log(`${prefix}    subtreeAreaNeededPerDay:   ${fmt(officialResult.subtreeAreaNeededPerDay)}`);
  console.log(`${prefix}    subtreeProfitPerArea:      ${fmt(officialResult.subtreeProfitPerArea)}`);
  console.log(`${prefix}    subtreeBuildCost:          ${fmtMoney(officialResult.subtreeBuildCost)}`);
  console.log(`${prefix}    subtreeBuildCostNeeded:    ${fmtMoney(officialResult.subtreeBuildCostNeeded)}`);
  console.log(`${prefix}    subtreeInputBuffer7:       ${fmtMoney(officialResult.subtreeInputBuffer7)}`);
  console.log(`${prefix}    runsPerDayRequired:        ${fmt(officialResult.runsPerDayRequired)}`);
  console.log(`${prefix}    demandUnitsPerDay:         ${fmt(officialResult.demandUnitsPerDay)}`);

  // Verification checks
  console.log(`${prefix}  ---- VERIFICATION ----`);
  check("subtreeAreaPerDay", totalAreaForOwnDenominator, officialResult.subtreeAreaPerDay, `${prefix}    `);
  check("subtreeAreaNeededPerDay", totalAreaNeededForParent, officialResult.subtreeAreaNeededPerDay, `${prefix}    `);
  check("subtreeProfitPerArea", totalProfitPA, officialResult.subtreeProfitPerArea, `${prefix}    `);
  check("runsPerDayRequired", runsPerDayRequiredHere, officialResult.runsPerDayRequired, `${prefix}    `);
  check("demandUnitsPerDay", demandUnitsPerDay, officialResult.demandUnitsPerDay, `${prefix}    `);

  return { childrenAreaNeededSum, result: officialResult };
}

async function main() {
  console.log("=".repeat(80));
  console.log("SCENARIO ANALYSIS VERIFICATION");
  console.log(`Exchange: ${EXCHANGE}  |  Price Type: ${PRICE_TYPE}  |  Source: local  |  Extraction: OFF`);
  console.log("=".repeat(80));

  // Load data directly — bypass buildReport/cachedBestRecipes
  // Use an empty bestMap so the engine explores all scenarios without pruning bias
  const { recipeMap, pricesMap } = await loadAllFromCsv(
    { recipes: LOCAL_DATA_SOURCES.recipes, prices: LOCAL_DATA_SOURCES.prices },
    { bestMap: {} }
  );

  const emptyBestMap: BestMap = {};

  const summaryRows: Array<{
    ticker: string;
    scenario: string;
    profitPA: number;
    totalArea: number;
    profitPerDay: number;
  }> = [];

  for (const ticker of TICKERS) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`TICKER: ${ticker}`);
    console.log("=".repeat(80));

    clearScenarioCache();

    const options = findAllMakeOptions(
      ticker, recipeMap, pricesMap, EXCHANGE, PRICE_TYPE,
      emptyBestMap, 0, true, false,
      undefined, undefined, undefined, undefined
    );

    if (!options.length) {
      console.log(`  No options found for ${ticker}`);
      continue;
    }

    // Rank by P/A at capacity (same as report.ts)
    const ranked = options
      .map(o => {
        const capacity = (o.output1Amount || 0) * (o.runsPerDay || 0);
        const r = buildScenarioRows(o, 0, capacity, false);
        return { o, r, capacity };
      })
      .sort((a, b) => (b.r.subtreeProfitPerArea ?? 0) - (a.r.subtreeProfitPerArea ?? 0));

    const best = ranked[0];

    console.log(`  Total Options: ${ranked.length}`);
    console.log(`  Best Scenario: ${best.o.scenario}`);
    console.log(`  Best P/A: ${fmt(best.r.subtreeProfitPerArea)}`);

    const capacity = best.capacity;
    printScenarioTrace(best.o, 0, capacity);

    summaryRows.push({
      ticker,
      scenario: best.o.scenario ?? "",
      profitPA: best.r.subtreeProfitPerArea ?? 0,
      totalArea: best.r.subtreeAreaPerDay ?? 0,
      profitPerDay: best.o.baseProfitPerDay ?? 0,
    });
  }

  // Summary
  console.log(`\n${"=".repeat(80)}`);
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(
    "Ticker".padEnd(8) +
    "| " + "P/A".padEnd(10) +
    "| " + "Total Area".padEnd(14) +
    "| " + "Profit/Day".padEnd(14) +
    "| Scenario"
  );
  console.log("-".repeat(80));
  for (const row of summaryRows) {
    console.log(
      row.ticker.padEnd(8) +
      "| " + fmt(row.profitPA).padEnd(10) +
      "| " + fmt(row.totalArea).padEnd(14) +
      "| " + fmtMoney(row.profitPerDay).padEnd(14) +
      "| " + row.scenario.substring(0, 50)
    );
  }
  console.log("=".repeat(80));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

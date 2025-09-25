import { NextResponse } from "next/server";
import recipesRaw from "@/src/mock/recipes.json";
import pricesRaw from "@/src/mock/prices.json";
import bestRaw from "@/src/mock/bestRecipeIDs.json";
import { buildPriceMap, buildRecipeMap } from "@/src/engine/maps";
import { BestMap, PriceMode } from "@/src/types";
import { findAllMakeOptions, buildScenarioRows } from "@/src/engine/engine";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker") || "";
  const priceMode = (searchParams.get("priceMode") as PriceMode) || "bid";

  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  // Build maps
  const recipeMap = buildRecipeMap(recipesRaw as any);
  const priceMap = buildPriceMap(pricesRaw as any);
  const bestMap: BestMap = {};
  (bestRaw as any[]).forEach(r => {
    bestMap[r.Ticker] = r.RecipeID;
  });

  // Compute
  const options = findAllMakeOptions(ticker, recipeMap, priceMap, priceMode, bestMap);
  if (!options.length) return NextResponse.json({ ticker, scenarios: [] });

  // rank + format (best full, rest summaries)
  const scenarioResults = options.map(option => {
    const optionDailyCapacity = option.output1Amount * (option.runsPerDay || 0);
    const result = buildScenarioRows(option, 0, optionDailyCapacity, true);
    return {
      option,
      rows: result.rows,
      profitPA: result.subtreeProfitPerArea || 0,
      areaDenom: result.subtreeAreaPerDay || 0,
    };
  }).sort((a, b) => b.profitPA - a.profitPA);

  const best = scenarioResults[0];
  const rest = scenarioResults.slice(1).map(r => ({
    profitPA: r.profitPA,
    scenario: r.option.scenario,
    areaPerDay: r.areaDenom
  }));

  return NextResponse.json({
    ticker,
    priceMode,
    best: { rows: best.rows, profitPA: best.profitPA },
    others: rest
  });
}


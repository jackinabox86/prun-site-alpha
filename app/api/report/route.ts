import { NextResponse } from "next/server";
import pricesRaw from "@mocks/prices.json";
import bestRaw from "@mocks/bestRecipeIDs.json";
import recipesRaw from "@mocks/recipes.json";

import { buildPriceMap, buildRecipeMap } from "@core/maps";
import { findAllMakeOptions, buildScenarioRows } from "@core/engine";

type PriceMode = 'bid' | 'ask';
type BestMap = Record<string, string>;

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

  // Best map (Ticker -> RecipeID)
  const bestMap: BestMap = {};
  (bestRaw as any[]).forEach((r: any) => {
    if (r?.Ticker && r?.RecipeID) bestMap[r.Ticker] = r.RecipeID;
  });

  // Compute
  const options = findAllMakeOptions(ticker, recipeMap, priceMap, priceMode, bestMap);
  if (!options.length) return NextResponse.json({ ticker, scenarios: [] });

  // Rank + format (best full, rest summaries)
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
  const others = scenarioResults.slice(1).map(r => ({
    profitPA: r.profitPA,
    scenario: r.option.scenario,
    areaPerDay: r.areaDenom,
  }));

  return NextResponse.json({
    ticker,
    priceMode,
    best: { rows: best.rows, profitPA: best.profitPA },
    others,
  });
}

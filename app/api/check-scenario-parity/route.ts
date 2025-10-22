// app/api/check-scenario-parity/route.ts
import { NextResponse } from "next/server";
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { findAllMakeOptions } from "@/core/engine";
import { scenarioEquals, normalizeScenario } from "@/core/scenario";
import { cachedBestRecipes } from "@/server/cachedBestRecipes";
import type { Exchange, PriceType } from "@/types";
import { CSV_URLS } from "@/lib/config";

export const runtime = "nodejs";

export async function GET() {
  // Get cached best recipes (will be generated on first call)
  const { bestMap, results: bestRecipeResults } = await cachedBestRecipes.getBestRecipes();

  // Load other data without best CSV
  const { recipeMap, pricesMap } = await loadAllFromCsv(
    { recipes: CSV_URLS.recipes, prices: CSV_URLS.prices },
    { bestMap }
  );

  const exchange: Exchange = "ANT";
  const priceType: PriceType = "bid";
  const mismatches: Array<{ ticker: string; sheet: string; computed: string }> = [];

  // Walk the generated best recipes and recompute each child's best scenario
  for (const result of bestRecipeResults) {
    const t = result.ticker;
    const sheetScenario = result.scenario;
    if (!t) continue;

    // depth=1 → "child mode": return exactly one best option for the ticker
    const best = findAllMakeOptions(t, recipeMap, pricesMap, exchange, priceType, bestMap, 1)[0];
    const computed = best?.scenario ?? "";

    if (!scenarioEquals(sheetScenario, computed)) {
      mismatches.push({
        ticker: t,
        sheet: normalizeScenario(sheetScenario),
        computed: normalizeScenario(computed),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    totalChecked: bestRecipeResults.length || 0,
    mismatches,
  });
}

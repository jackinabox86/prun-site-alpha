// app/api/tickers/route.ts
import { NextResponse } from "next/server";
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { GCS_DATA_SOURCES, GCS_STATIC_BASE } from "@/lib/config";
import { cachedBestRecipes } from "@/server/cachedBestRecipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // Extract extraction mode parameter
    const url = new URL(req.url);
    const extractionMode = url.searchParams.get("extractionMode") === "true";

    // Use GCS data sources (always use production data for tickers)
    const dataSources = GCS_DATA_SOURCES;

    // Get bestMap from cached best recipes (use ANT bid as default)
    const { bestMap } = await cachedBestRecipes.getBestRecipes("gcs", "ANT", "bid");

    // Load recipes and prices from GCS
    const { recipeMap } = await loadAllFromCsv(
      {
        recipes: dataSources.recipes,
        prices: dataSources.prices,
      },
      { bestMap }
    );

    // If extraction mode is enabled, also load expanded recipes for ANT
    if (extractionMode) {
      try {
        const expandedRecipeUrl = `${GCS_STATIC_BASE}/ANT-expandedrecipes-dynamic.csv`;
        const expandedData = await loadAllFromCsv(
          { recipes: expandedRecipeUrl, prices: dataSources.prices },
          { bestMap }
        );

        // Transform expanded recipes by removing Planet column (same as in report.ts)
        const planetIndex = expandedData.recipeMap.headers.indexOf("Planet");
        if (planetIndex !== -1) {
          expandedData.recipeMap.headers.splice(planetIndex, 1);
          for (const recipes of Object.values(expandedData.recipeMap.map)) {
            for (const recipe of recipes) {
              recipe.splice(planetIndex, 1);
            }
          }
        }

        // Merge expanded recipe tickers into the main map
        for (const [ticker, recipes] of Object.entries(expandedData.recipeMap.map)) {
          if (!recipeMap.map[ticker]) {
            recipeMap.map[ticker] = [];
          }
          recipeMap.map[ticker].push(...recipes);
        }
      } catch (error: any) {
        console.warn(`Failed to load expanded recipes for tickers: ${error.message}`);
        // Continue with standard tickers even if expanded recipes fail
      }
    }

    const tickers = Object.keys(recipeMap.map || {}).sort((a, b) =>
      a.localeCompare(b)
    );

    return NextResponse.json({ tickers });
  } catch (err: any) {
    console.error("Failed to load tickers:", err?.message ?? err);
    return NextResponse.json({ tickers: [] }, { status: 200 });
  }
}

// app/api/tickers/route.ts
import { NextResponse } from "next/server";
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { GCS_DATA_SOURCES } from "@/lib/config";
import { cachedBestRecipes } from "@/server/cachedBestRecipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
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

    const tickers = Object.keys(recipeMap.map || {}).sort((a, b) =>
      a.localeCompare(b)
    );

    return NextResponse.json({ tickers });
  } catch (err: any) {
    console.error("Failed to load tickers:", err?.message ?? err);
    return NextResponse.json({ tickers: [] }, { status: 200 });
  }
}

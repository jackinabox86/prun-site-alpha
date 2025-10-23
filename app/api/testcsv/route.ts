import { NextResponse } from "next/server";
import { GCS_DATA_SOURCES } from "@/lib/config";
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { cachedBestRecipes } from "@/server/cachedBestRecipes";

// Force Node runtime (not Edge) because we use Node-y libs/fetch patterns
export const runtime = "nodejs";
// Cyrus comment
// Optional: always fetch fresh (disable caching) during dev
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Use GCS mode for testing (production data)
    const priceSource = "gcs";
    const { bestMap } = await cachedBestRecipes.getBestRecipes(priceSource);

    // Load other data without best CSV
    const { recipeMap, pricesMap } = await loadAllFromCsv(
      { recipes: GCS_DATA_SOURCES.recipes, prices: GCS_DATA_SOURCES.prices },
      { bestMap }
    );

    // Build a compact summary so you can quickly see if it worked
    const recipeTickers = Object.keys(recipeMap.map);
    const pricesTickers = Object.keys(pricesMap);
    const bestTickers   = Object.keys(bestMap);

    const sampleRecipeTicker = recipeTickers[0] ?? null;
    const samplePriceEntry   = pricesTickers[0] ? { [pricesTickers[0]]: pricesMap[pricesTickers[0]] } : null;

    return NextResponse.json({
      ok: true,
      counts: {
        recipes: recipeTickers.length,
        prices: pricesTickers.length,
        best:    bestTickers.length,
      },
      sample: {
        recipeHeaders: recipeMap.headers?.slice(0, 12) ?? [],
        sampleRecipeTicker,
        samplePriceEntry,
        bestMapFirst: bestTickers[0] ? { [bestTickers[0]]: bestMap[bestTickers[0]] } : null,
      }
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}

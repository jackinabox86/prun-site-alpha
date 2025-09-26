import { NextResponse } from "next/server";
import { CSV_URLS } from "@/lib/config";
import { loadAllFromCsv } from "@/lib/loadFromCsv";

// Force Node runtime (not Edge) because we use Node-y libs/fetch patterns
export const runtime = "nodejs";

// Optional: always fetch fresh (disable caching) during dev
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { recipeMap, pricesMap, bestMap } = await loadAllFromCsv(CSV_URLS);

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

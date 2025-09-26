import { fetchCsv } from "./csvFetch";
import { buildRecipeMap } from "@/core/maps";
import { readBestRecipeMap } from "@/core/bestMap";
import { PricesMap, RecipeMap, BestMap } from "@/types";

export async function loadAllFromCsv(urls: {
  recipes: string; prices: string; best: string;
}): Promise<{ recipeMap: RecipeMap; pricesMap: PricesMap; bestMap: BestMap }> {
  const [recipesRows, pricesRows, bestRows] = await Promise.all([
    fetchCsv(urls.recipes), // -> Array<Record<string, any>>
    fetchCsv(urls.prices),
    fetchCsv(urls.best),
  ]);

  // --- Guards (nice errors vs silent failures)
  if (!recipesRows.length) throw new Error("Recipes CSV returned no rows");
  if (!pricesRows.length) throw new Error("Prices CSV returned no rows");
  if (!bestRows.length)   throw new Error("BestRecipeIDs CSV returned no rows");
  if (!("Ticker" in recipesRows[0])) throw new Error("Recipes CSV missing 'Ticker' header");

  // Recipes: object rows -> sheet-like rows for buildRecipeMap([headers, ...rows])
  const recipeHeaders = Object.keys(recipesRows[0]);
  const recipeSheet: any[][] = [
    recipeHeaders,
    ...recipesRows.map(r => recipeHeaders.map(h => coerce(r[h]))),
  ];
  const recipeMap = buildRecipeMap(recipeSheet);

  // Prices: build PricesMap (ask/bid/pp7/pp30)
  const pricesMap = pricesRows.reduce((acc, r) => {
    const t = r["Ticker"];
    if (!t) return acc;
    acc[t] = {
      ask:  toNum(r["AI1-AskPrice"]),
      bid:  toNum(r["AI1-BidPrice"]),
      pp7:  toNum(r["A1-PP7"]),
      pp30: toNum(r["A1-PP30"]),
    };
    return acc;
  }, {} as PricesMap);

  // Best map: pass object rows directly
  const bestMap = readBestRecipeMap(bestRows as Array<Record<string, any>>);

  return { recipeMap, pricesMap, bestMap };
}

function toNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null; // mirrors Apps Script: only >0 counts
}

function coerce(v: any) {
  if (v === "" || v == null) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : v; // numeric strings -> numbers
}

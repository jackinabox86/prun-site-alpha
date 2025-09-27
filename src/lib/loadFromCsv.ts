// src/lib/loadFromCsv.ts
import { fetchCsv } from "./csvFetch";
import { buildRecipeMap } from "@/core/maps";       // <- lowercase 'maps'
import { readBestRecipeMap } from "@/core/bestMap";

import type {
  PricesMap,
  RecipeMap,
  BestMap,
  RecipeRow,
  RecipeSheet,
} from "@/types";

export async function loadAllFromCsv(urls: {
  recipes: string;
  prices: string;
  best: string;
}): Promise<{
  recipeMap: RecipeMap;
  pricesMap: PricesMap;
  bestMap: BestMap;
  __rawBestRows: Array<Record<string, any>>;
}> {
  const [recipesRows, pricesRows, bestRows] = await Promise.all([
    fetchCsv(urls.recipes), // -> Array<Record<string, any>>
    fetchCsv(urls.prices),
    fetchCsv(urls.best),
  ]);

  // --- Guards (nice errors vs silent failures)
  if (!recipesRows.length) throw new Error("Recipes CSV returned no rows");
  if (!pricesRows.length)  throw new Error("Prices CSV returned no rows");
  if (!bestRows.length)    throw new Error("BestRecipeIDs CSV returned no rows");
  if (!("Ticker" in recipesRows[0])) {
    throw new Error("Recipes CSV missing 'Ticker' header");
  }

  // Recipes: object rows -> sheet-like rows expected by buildRecipeMap([headers, ...rows])
  const recipeHeaders = Object.keys(recipesRows[0]) as string[];
  const typedRows: RecipeRow[] = recipesRows.map((obj) =>
    recipeHeaders.map((h) => coerce(obj[h])) as RecipeRow
  );
  const recipeSheet: RecipeSheet = [recipeHeaders, ...typedRows];
  const recipeMap: RecipeMap = buildRecipeMap(recipeSheet);

  // Prices: build PricesMap (ask/bid/pp7/pp30)
  const pricesMap: PricesMap = pricesRows.reduce((acc, r) => {
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

  // Best map: pass object rows directly (returns { recipeId, scenario } per ticker)
  const bestMap: BestMap = readBestRecipeMap(bestRows as Array<Record<string, any>>);

  // include raw best rows for parity checks / debugging
  return { recipeMap, pricesMap, bestMap, __rawBestRows: bestRows };
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function coerce(v: unknown): string | number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : String(v);
}

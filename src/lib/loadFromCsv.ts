// src/lib/loadFromCsv.ts
import { fetchCsv } from "./csvFetch";
import { buildRecipeMap, buildPriceMap } from "@/core/maps";       // <- lowercase 'maps'
import { readBestRecipeMap } from "@/core/bestMap";

import type {
  PricesMap,
  RecipeMap,
  BestMap,
  RecipeRow,
  RecipeSheet,
} from "@/types";

export async function loadAllFromCsv(
  urls: {
    recipes: string;
    prices: string;
    best?: string;
  },
  options?: {
    bestMap?: BestMap;
  }
): Promise<{
  recipeMap: RecipeMap;
  pricesMap: PricesMap;
  bestMap: BestMap;
  __rawBestRows: Array<Record<string, any>>;
}> {
  // If bestMap is provided via options, don't fetch best CSV
  const shouldFetchBest = !options?.bestMap && urls.best;

  const promises = [
    fetchCsv(urls.recipes),
    fetchCsv(urls.prices),
  ];

  if (shouldFetchBest) {
    promises.push(fetchCsv(urls.best!));
  }

  const results = await Promise.all(promises);
  const recipesRows = results[0];
  const pricesRows = results[1];
  const bestRows = shouldFetchBest ? results[2] : [];

  // --- Guards (nice errors vs silent failures)
  if (!recipesRows.length) throw new Error("Recipes CSV returned no rows");
  if (!pricesRows.length)  throw new Error("Prices CSV returned no rows");
  if (!options?.bestMap && !bestRows.length) {
    throw new Error("BestRecipeIDs CSV returned no rows and no bestMap provided");
  }
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

  // Prices: build PricesMap with all exchanges
  const pricesMap: PricesMap = buildPriceMap(
  pricesRows.map(r => ({
    Ticker: r["Ticker"],
    // ANT (Antares) - AI1
    "AI1-AskPrice": Number(r["AI1-AskPrice"]) || 0,
    "AI1-BidPrice": Number(r["AI1-BidPrice"]) || 0,
    "A1-PP7":       Number(r["A1-PP7"])       || 0,
    "A1-PP30":      Number(r["A1-PP30"])      || 0,
    // CIS (Castillon) - CI1
    "CI1-AskPrice": Number(r["CI1-AskPrice"]) || 0,
    "CI1-BidPrice": Number(r["CI1-BidPrice"]) || 0,
    "CI1-PP7":      Number(r["CI1-PP7"])      || 0,
    "CI1-PP30":     Number(r["CI1-PP30"])     || 0,
    // ICA (Icarus) - IC1
    "IC1-AskPrice": Number(r["IC1-AskPrice"]) || 0,
    "IC1-BidPrice": Number(r["IC1-BidPrice"]) || 0,
    "IC1-PP7":      Number(r["IC1-PP7"])      || 0,
    "IC1-PP30":     Number(r["IC1-PP30"])     || 0,
    // NCC (Neocassildas) - NC1
    "NC1-AskPrice": Number(r["NC1-AskPrice"]) || 0,
    "NC1-BidPrice": Number(r["NC1-BidPrice"]) || 0,
    "NC1-PP7":      Number(r["NC1-PP7"])      || 0,
    "NC1-PP30":     Number(r["NC1-PP30"])     || 0,
    // UNV (Universe) - future columns
    "UNV-AskPrice": Number(r["UNV-AskPrice"]) || 0,
    "UNV-BidPrice": Number(r["UNV-BidPrice"]) || 0,
    "UNV-PP7":      Number(r["UNV-PP7"])      || 0,
    "UNV-PP30":     Number(r["UNV-PP30"])     || 0,
  }))
);

  // Best map: use provided bestMap or read from CSV
  const bestMap: BestMap = options?.bestMap ?? readBestRecipeMap(bestRows as Array<Record<string, any>>);

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

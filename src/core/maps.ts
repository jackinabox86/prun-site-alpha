import { PricesMap, RecipeMap, RecipeRow, RecipeSheet } from "../types";

export function buildPriceMap(
  prices: Array<{ Ticker: string; ["AI1-AskPrice"]?: number; ["AI1-BidPrice"]?: number }>
): PricesMap {
  const map: PricesMap = {};
  for (const row of prices) {
    const t = row["Ticker"];
    if (!t) continue;
    map[t] = {
      ask: row["AI1-AskPrice"] && row["AI1-AskPrice"] > 0 ? row["AI1-AskPrice"] : null,
      bid: row["AI1-BidPrice"] && row["AI1-BidPrice"] > 0 ? row["AI1-BidPrice"] : null,
    };
  }
  return map;
}

export function buildRecipeMap(recipes: RecipeSheet): RecipeMap {
  const headers = recipes[0]; // string[]
  const tickerIndex = headers.indexOf("Ticker");
  const map: RecipeMap["map"] = {};

  for (let i = 1; i < recipes.length; i++) {
    const row = recipes[i] as RecipeRow;
    const ticker = String(row[tickerIndex] ?? "");
    if (!ticker) continue;
    if (!map[ticker]) map[ticker] = [];
    map[ticker].push(row);
  }
  return { map, headers };
}

import { PricesMap, RecipeMap, RecipeRow, RecipeSheet } from "../types";

export function buildPriceMap(
  prices: Array<{
    Ticker: string;
    ["AI1-AskPrice"]?: number;
    ["AI1-BidPrice"]?: number;
    ["A1-PP7"]?: number;     // add
    ["A1-PP30"]?: number;    // add
  }>
): PricesMap {
  const map: PricesMap = {};
  for (const row of prices) {
    const t = row.Ticker;
    if (!t) continue;
    map[t] = {
      ask:  row["AI1-AskPrice"] && row["AI1-AskPrice"] > 0 ? row["AI1-AskPrice"] : null,
      bid:  row["AI1-BidPrice"] && row["AI1-BidPrice"] > 0 ? row["AI1-BidPrice"] : null,
      pp7:  row["A1-PP7"]       && row["A1-PP7"]       > 0 ? row["A1-PP7"]       : null,
      pp30: row["A1-PP30"]      && row["A1-PP30"]      > 0 ? row["A1-PP30"]      : null,
    };
  }
  return map;
}

export function buildRecipeMap(recipes: RecipeSheet): RecipeMap {
  const headers = recipes[0]; // string[]
  const tickerIndex = headers.indexOf("Ticker");

  if (tickerIndex === -1) {
    throw new Error("Recipes sheet is missing required 'Ticker' column header");
  }

  const map: RecipeMap["map"] = {};

  for (let i = 1; i < recipes.length; i++) {
    const row = recipes[i] as RecipeRow;

    const rawTicker = row[tickerIndex];
    if (rawTicker == null) continue;

    const ticker =
      typeof rawTicker === "string" ? rawTicker.trim() : String(rawTicker);

    if (!ticker) continue;

    if (!map[ticker]) map[ticker] = [];
    map[ticker].push(row);
  }

  return { map, headers };
}

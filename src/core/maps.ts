import { PricesMap, RecipeMap, RecipeRow, RecipeSheet, ExchangePrices } from "@/types";

export function buildPriceMap(
  prices: Array<{
    Ticker: string;
    // ANT (Antares) - AI1 columns
    ["AI1-AskPrice"]?: number;
    ["AI1-BidPrice"]?: number;
    ["A1-PP7"]?: number;
    ["A1-PP30"]?: number;
    // CIS (Castillon) - CI1 columns
    ["CI1-AskPrice"]?: number;
    ["CI1-BidPrice"]?: number;
    ["CI1-PP7"]?: number;
    ["CI1-PP30"]?: number;
    // ICA (Icarus) - IC1 columns
    ["IC1-AskPrice"]?: number;
    ["IC1-BidPrice"]?: number;
    ["IC1-PP7"]?: number;
    ["IC1-PP30"]?: number;
    // NCC (Neocassildas) - NC1 columns
    ["NC1-AskPrice"]?: number;
    ["NC1-BidPrice"]?: number;
    ["NC1-PP7"]?: number;
    ["NC1-PP30"]?: number;
    // UNV (Universe) - future columns
    ["UNV-AskPrice"]?: number;
    ["UNV-BidPrice"]?: number;
    ["UNV-PP7"]?: number;
    ["UNV-PP30"]?: number;
  }>
): PricesMap {
  const map: PricesMap = {};

  function toPrice(value: number | undefined): number | null {
    return value && value > 0 ? value : null;
  }

  for (const row of prices) {
    const t = row.Ticker;
    if (!t) continue;

    map[t] = {
      ANT: {
        ask:  toPrice(row["AI1-AskPrice"]),
        bid:  toPrice(row["AI1-BidPrice"]),
        pp7:  toPrice(row["A1-PP7"]),
        pp30: toPrice(row["A1-PP30"]),
      },
      CIS: {
        ask:  toPrice(row["CI1-AskPrice"]),
        bid:  toPrice(row["CI1-BidPrice"]),
        pp7:  toPrice(row["CI1-PP7"]),
        pp30: toPrice(row["CI1-PP30"]),
      },
      ICA: {
        ask:  toPrice(row["IC1-AskPrice"]),
        bid:  toPrice(row["IC1-BidPrice"]),
        pp7:  toPrice(row["IC1-PP7"]),
        pp30: toPrice(row["IC1-PP30"]),
      },
      NCC: {
        ask:  toPrice(row["NC1-AskPrice"]),
        bid:  toPrice(row["NC1-BidPrice"]),
        pp7:  toPrice(row["NC1-PP7"]),
        pp30: toPrice(row["NC1-PP30"]),
      },
      UNV: {
        ask:  toPrice(row["UNV-AskPrice"]),
        bid:  toPrice(row["UNV-BidPrice"]),
        pp7:  toPrice(row["UNV-PP7"]),
        pp30: toPrice(row["UNV-PP30"]),
      },
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

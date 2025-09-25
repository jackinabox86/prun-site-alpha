import { PricesMap, PriceMode } from "../types";

export function findPrice(ticker: string, priceMap: PricesMap, mode: PriceMode): number | null {
  const entry = priceMap[ticker];
  if (!entry) return null;
  return mode === "ask" ? entry.ask : entry.bid;
}


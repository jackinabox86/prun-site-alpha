import { PricesMap, PriceMode } from "../types";

export function findPrice(ticker: string, priceMap: PricesMap, mode: PriceMode): number | null {
  const e = priceMap[ticker];
  if (!e) return null;
  if (mode === "ask")  return e.ask;
  if (mode === "pp7")  return e.pp7;
  if (mode === "pp30") return e.pp30;
  return e.bid; // default bid, same as Apps Script
}

import { PricesMap, PriceMode, Exchange, PriceType } from "../types";

// New function that takes exchange and priceType
export function findPrice(
  ticker: string,
  priceMap: PricesMap,
  exchange: Exchange,
  priceType: PriceType
): number | null {
  const tickerData = priceMap[ticker];
  if (!tickerData) return null;

  const exchangeData = tickerData[exchange];
  if (!exchangeData) return null;

  return exchangeData[priceType];
}

// Legacy function for backward compatibility
export function findPriceLegacy(ticker: string, priceMap: PricesMap, mode: PriceMode): number | null {
  // Default to ANT exchange for legacy mode
  const tickerData = priceMap[ticker];
  if (!tickerData) return null;

  const antData = tickerData.ANT;
  if (!antData) return null;

  if (mode === "ask")  return antData.ask;
  if (mode === "pp7")  return antData.pp7;
  if (mode === "pp30") return antData.pp30;
  return antData.bid; // default bid
}

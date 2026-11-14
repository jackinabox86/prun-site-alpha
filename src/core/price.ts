import { PricesMap, Exchange, PriceType } from "../types";

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

import { Exchange } from "@/types";

export const EXCHANGE_DISPLAY_NAMES: Record<Exchange, string> = {
  ANT: "ANT",
  CIS: "BEN",
  ICA: "HRT",
  NCC: "MOR",
  UNV: "UNV",
};

export function getExchangeDisplayName(exchange: Exchange): string {
  return EXCHANGE_DISPLAY_NAMES[exchange];
}

export function getExchangeFromDisplayName(displayName: string): Exchange | null {
  const entry = Object.entries(EXCHANGE_DISPLAY_NAMES).find(
    ([_, display]) => display === displayName
  );
  return entry ? (entry[0] as Exchange) : null;
}

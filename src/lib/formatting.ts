import type { Exchange } from "../types";

/**
 * Get the currency symbol for a given exchange
 */
export function getCurrencySymbol(exchange: Exchange): string {
  switch (exchange) {
    case "CIS":
      return "₡";
    case "ICA":
      return "ǂ";
    case "NCC":
      return "₦";
    case "ANT":
    case "UNV":
      return "₳";
    default:
      return "₳"; // Default to ANT symbol
  }
}

/**
 * Format a number as currency with 2 decimal places
 * Used for exact currency amounts (costs, profits)
 */
export function formatCurrency(
  value: number | null | undefined,
  exchange: Exchange,
  fallback: string = "n/a"
): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  const symbol = getCurrencySymbol(exchange);
  return `${symbol}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/**
 * Format a number as currency rounded to whole numbers
 * Used for large amounts where precision is less critical
 */
export function formatCurrencyRounded(
  value: number | null | undefined,
  exchange: Exchange,
  fallback: string = "n/a"
): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  const symbol = getCurrencySymbol(exchange);
  return `${symbol}${Math.round(value).toLocaleString()}`;
}

/**
 * Format profit per area (removes trailing .0)
 * Displays P/A metrics with 1 decimal place
 */
export function formatProfitPerArea(
  value: number | null | undefined,
  exchange: Exchange,
  fallback: string = "n/a"
): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  const symbol = getCurrencySymbol(exchange);
  return `${symbol}${value.toFixed(1).replace(/\.0$/, "")}`;
}

/**
 * Format a general number with intelligent decimal places
 * Numbers >= 1000 use no decimals, others use 3
 */
export function formatNumber(
  value: number | undefined | null,
  fallback: string = "n/a"
): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.abs(value) >= 1000
    ? value.toLocaleString()
    : value.toFixed(3);
}

/**
 * Format ROI days (removes trailing .0)
 */
export function formatROI(
  value: number | undefined | null,
  fallback: string = "n/a"
): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  return value.toFixed(1).replace(/\.0$/, "");
}

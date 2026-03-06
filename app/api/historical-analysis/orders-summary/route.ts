import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface BuyingOrder {
  OrderId: string;
  CompanyId: string;
  CompanyName: string;
  CompanyCode: string;
  ItemCount: number;
  ItemCost: number;
}

interface ExchangeEntry {
  BuyingOrders: BuyingOrder[];
  MaterialTicker: string;
  MaterialName: string;
  ExchangeCode: string;
  ExchangeName: string;
  Currency: string;
}

interface TickerOrderSummary {
  ticker: string;
  totalValue: number;
  totalItems: number;
  orderCount: number;
}

interface ExchangeOrdersSummary {
  exchange: string;
  exchangeName: string;
  currency: string;
  tickers: TickerOrderSummary[];
  exchangeTotal: number;
  exchangeTotalItems: number;
  exchangeOrderCount: number;
}

/**
 * Orders Summary: reads the exchange snapshot and sums buying orders
 * per ticker.exchange pair, grouped by exchange.
 *
 * Buying orders from market makers (AIMM, NCMM, ICMM, CIMM) are excluded.
 */
export async function GET() {
  try {
    const res = await fetch("https://rest.fnar.net/exchange/full", {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `FIO API returned ${res.status}` },
        { status: 502 }
      );
    }

    const entries: ExchangeEntry[] = await res.json();

    // Group by exchange
    const exchangeMap = new Map<
      string,
      {
        exchangeName: string;
        currency: string;
        tickers: Map<string, { totalValue: number; totalItems: number; orderCount: number }>;
      }
    >();

    for (const entry of entries) {
      const exchangeCode = entry.ExchangeCode;
      const ticker = entry.MaterialTicker;

      if (!exchangeMap.has(exchangeCode)) {
        exchangeMap.set(exchangeCode, {
          exchangeName: entry.ExchangeName,
          currency: entry.Currency,
          tickers: new Map(),
        });
      }

      const exchangeData = exchangeMap.get(exchangeCode)!;

      // Filter out market maker orders and sum
      const MM_CODES = new Set(["AIMM", "NCMM", "ICMM", "CIMM"]);
      const filteredOrders = entry.BuyingOrders.filter(
        (order) => !MM_CODES.has(order.CompanyCode)
      );

      if (filteredOrders.length === 0) continue;

      const totalValue = filteredOrders.reduce(
        (sum, order) => sum + order.ItemCount * order.ItemCost,
        0
      );
      const totalItems = filteredOrders.reduce(
        (sum, order) => sum + order.ItemCount,
        0
      );

      const existing = exchangeData.tickers.get(ticker);
      if (existing) {
        existing.totalValue += totalValue;
        existing.totalItems += totalItems;
        existing.orderCount += filteredOrders.length;
      } else {
        exchangeData.tickers.set(ticker, {
          totalValue,
          totalItems,
          orderCount: filteredOrders.length,
        });
      }
    }

    // Build response
    const exchanges: ExchangeOrdersSummary[] = [];
    let grandTotal = 0;
    let grandTotalItems = 0;
    let grandOrderCount = 0;

    for (const [exchangeCode, data] of exchangeMap) {
      const tickers: TickerOrderSummary[] = Array.from(data.tickers.entries())
        .map(([ticker, stats]) => ({
          ticker,
          totalValue: stats.totalValue,
          totalItems: stats.totalItems,
          orderCount: stats.orderCount,
        }))
        .sort((a, b) => b.totalValue - a.totalValue);

      const exchangeTotal = tickers.reduce((sum, t) => sum + t.totalValue, 0);
      const exchangeTotalItems = tickers.reduce((sum, t) => sum + t.totalItems, 0);
      const exchangeOrderCount = tickers.reduce((sum, t) => sum + t.orderCount, 0);

      grandTotal += exchangeTotal;
      grandTotalItems += exchangeTotalItems;
      grandOrderCount += exchangeOrderCount;

      exchanges.push({
        exchange: exchangeCode,
        exchangeName: data.exchangeName,
        currency: data.currency,
        tickers,
        exchangeTotal,
        exchangeTotalItems,
        exchangeOrderCount,
      });
    }

    // Sort exchanges by total value descending
    exchanges.sort((a, b) => b.exchangeTotal - a.exchangeTotal);

    return NextResponse.json({
      exchanges,
      grandTotal,
      grandTotalItems,
      grandOrderCount,
      entriesProcessed: entries.length,
      lastUpdated: Date.now(),
    });
  } catch (error) {
    console.error("Error in orders-summary API:", error);
    return NextResponse.json(
      {
        error: "Failed to process exchange data",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

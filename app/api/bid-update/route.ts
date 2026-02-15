import { NextResponse } from "next/server";

const FIO_BASE = "https://rest.fnar.net";
const FIO_AUTH = "ad8aa2f9-a0a9-4a1b-8428-8b152096c0d0";
const USERNAME = "jackinabox";

interface CxosOrder {
  OrderId: string;
  CompanyId: string;
  CompanyName: string;
  CompanyCode: string;
  ExchangeCode: string;
  ExchangeName: string;
  MaterialId: string;
  MaterialName: string;
  MaterialTicker: string;
  ItemCount: number;
  ItemCost: number;
  InitialAmount: number;
  FilledAmount: number;
  Status: string;
  OrderType: string;
  CreatedEpochMs: number;
  [key: string]: unknown;
}

interface ExchangeTicker {
  MaterialTicker: string;
  ExchangeCode: string;
  MMBuy: number | null;
  MMSell: number | null;
  PriceAverage: number | null;
  Ask: number | null;
  AskCount: number;
  Bid: number | null;
  BidCount: number;
  Supply: number;
  Demand: number;
  [key: string]: unknown;
}

export interface BidComparison {
  materialTicker: string;
  exchangeCode: string;
  myLimit: number;
  marketBid: number;
  difference: number;
  percentBelow: number;
  status: string;
  itemCount: number;
  initialAmount: number;
  filledAmount: number;
  orderType: string;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const [ordersRes, exchangeRes] = await Promise.all([
      fetch(`${FIO_BASE}/cxos/${USERNAME}`, {
        headers: {
          accept: "application/json",
          Authorization: FIO_AUTH,
        },
      }),
      fetch(`${FIO_BASE}/exchange/all`, {
        headers: {
          accept: "application/json",
        },
      }),
    ]);

    if (!ordersRes.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch orders: ${ordersRes.status} ${ordersRes.statusText}`,
        },
        { status: 502 }
      );
    }
    if (!exchangeRes.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch exchange data: ${exchangeRes.status} ${exchangeRes.statusText}`,
        },
        { status: 502 }
      );
    }

    const orders: CxosOrder[] = await ordersRes.json();
    const exchangeData: ExchangeTicker[] = await exchangeRes.json();

    // Build a lookup map: "TICKER.EXCHANGE" -> Bid
    const bidMap = new Map<string, number>();
    for (const entry of exchangeData) {
      if (entry.Bid != null && entry.Bid > 0) {
        bidMap.set(
          `${entry.MaterialTicker}.${entry.ExchangeCode}`,
          entry.Bid
        );
      }
    }

    // Normalize status values for comparison
    const activeStatuses = new Set([
      "PLACED",
      "PARTIALLY_FILLED",
      "partially fulfilled",
      "placed",
    ]);

    // Filter for active buy orders and compare
    const comparisons: BidComparison[] = [];

    for (const order of orders) {
      const status = (order.Status || "").toString();
      const orderType = (order.OrderType || "").toString();

      // Only look at active buying orders
      if (!activeStatuses.has(status) && !activeStatuses.has(status.toLowerCase())) {
        continue;
      }
      if (
        orderType.toUpperCase() !== "BUYING" &&
        orderType.toUpperCase() !== "BUY"
      ) {
        continue;
      }

      const key = `${order.MaterialTicker}.${order.ExchangeCode}`;
      const marketBid = bidMap.get(key);

      if (marketBid != null && marketBid > order.ItemCost) {
        comparisons.push({
          materialTicker: order.MaterialTicker,
          exchangeCode: order.ExchangeCode,
          myLimit: order.ItemCost,
          marketBid,
          difference: marketBid - order.ItemCost,
          percentBelow: ((marketBid - order.ItemCost) / marketBid) * 100,
          status,
          itemCount: order.ItemCount ?? 0,
          initialAmount: order.InitialAmount ?? order.ItemCount ?? 0,
          filledAmount: order.FilledAmount ?? 0,
          orderType,
        });
      }
    }

    // Sort by percent below (biggest gap first)
    comparisons.sort((a, b) => b.percentBelow - a.percentBelow);

    // Also return debug info: total orders, active buy orders count
    const activeBuyOrders = orders.filter((o) => {
      const s = (o.Status || "").toString().toLowerCase();
      const t = (o.OrderType || "").toString().toUpperCase();
      return (
        (s === "placed" || s === "partially_filled" || s === "partially fulfilled") &&
        (t === "BUYING" || t === "BUY")
      );
    });

    return NextResponse.json({
      comparisons,
      totalOrders: orders.length,
      activeBuyOrders: activeBuyOrders.length,
      outbidCount: comparisons.length,
      // Include a sample order for debugging field names (first order only)
      _sampleOrder: orders.length > 0 ? orders[0] : null,
      _sampleExchange:
        exchangeData.length > 0 ? exchangeData[0] : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

const FIO_BASE = "https://rest.fnar.net";
const FIO_AUTH = "ad8aa2f9-a0a9-4a1b-8428-8b152096c0d0";
const USERNAME = "jackinabox";

interface CxosOrder {
  CXOSTradeOrderId: string;
  ExchangeCode: string;
  ExchangeName: string;
  BrokerId: string;
  OrderType: string;
  MaterialName: string;
  MaterialTicker: string;
  MaterialId: string;
  Amount: number;
  InitialAmount: number;
  Limit: number;
  LimitCurrency: string;
  Status: string;
  CreatedEpochMs: number;
  UserNameSubmitted: string;
  Timestamp: string;
  Trades: unknown[];
  [key: string]: unknown;
}

interface ExchangeTicker {
  MaterialTicker: string;
  ExchangeCode: string;
  MMBuy: number | null;
  MMSell: number | null;
  PriceAverage: number | null;
  Ask: number | null;
  AskCount: number | null;
  Bid: number | null;
  BidCount: number | null;
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
  amount: number;
  initialAmount: number;
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

    // Filter for active buy orders: "PLACED" or "PARTIALLY_FILLED"
    const isActiveStatus = (status: string) => {
      const s = status.toUpperCase();
      return s === "PLACED" || s === "PARTIALLY_FILLED";
    };

    const isBuyOrder = (orderType: string) => {
      return orderType.toUpperCase() === "BUYING";
    };

    // Filter for active buy orders and compare
    const comparisons: BidComparison[] = [];

    for (const order of orders) {
      const status = (order.Status || "").toString();
      const orderType = (order.OrderType || "").toString();

      if (!isActiveStatus(status) || !isBuyOrder(orderType)) {
        continue;
      }

      const key = `${order.MaterialTicker}.${order.ExchangeCode}`;
      const marketBid = bidMap.get(key);

      if (marketBid != null && marketBid > order.Limit) {
        comparisons.push({
          materialTicker: order.MaterialTicker,
          exchangeCode: order.ExchangeCode,
          myLimit: order.Limit,
          marketBid,
          difference: marketBid - order.Limit,
          percentBelow: ((marketBid - order.Limit) / marketBid) * 100,
          status,
          amount: order.Amount,
          initialAmount: order.InitialAmount,
          orderType,
        });
      }
    }

    // Sort by percent below (biggest gap first)
    comparisons.sort((a, b) => b.percentBelow - a.percentBelow);

    const activeBuyOrders = orders.filter(
      (o) => isActiveStatus(o.Status || "") && isBuyOrder(o.OrderType || "")
    );

    return NextResponse.json({
      comparisons,
      totalOrders: orders.length,
      activeBuyOrders: activeBuyOrders.length,
      outbidCount: comparisons.length,
      _sampleOrder: orders.length > 0 ? orders[0] : null,
      _sampleExchange: exchangeData.length > 0 ? exchangeData[0] : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

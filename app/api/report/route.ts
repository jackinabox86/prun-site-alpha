// app/api/report/route.ts
import { NextResponse } from "next/server";
import { buildReport } from "@/server/report";
import type { PriceMode, Exchange, PriceType } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_EXCHANGES: Exchange[] = ["ANT", "CIS", "ICA", "NCC", "UNV"];
const VALID_PRICE_TYPES: PriceType[] = ["ask", "bid", "pp7", "pp30"];

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0',
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") ?? "CBS").toUpperCase();

    // Support new exchange + priceType parameters
    const exchangeParam = (url.searchParams.get("exchange") ?? "ANT").toUpperCase();
    if (!VALID_EXCHANGES.includes(exchangeParam as Exchange)) {
      return NextResponse.json(
        { schemaVersion: 3, ok: false, error: `Invalid exchange "${exchangeParam}". Valid exchanges: ${VALID_EXCHANGES.join(", ")}` },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }
    const exchange = exchangeParam as Exchange;

    const priceTypeParam = (url.searchParams.get("priceType") ?? "bid").toLowerCase();
    if (!VALID_PRICE_TYPES.includes(priceTypeParam as PriceType)) {
      return NextResponse.json(
        { schemaVersion: 3, ok: false, error: `Invalid priceType "${priceTypeParam}". Valid price types: ${VALID_PRICE_TYPES.join(", ")}` },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }
    const priceType = priceTypeParam as PriceType;

    // Extract force make/buy constraints
    const forceMake = url.searchParams.get("forceMake") || undefined;
    const forceBuy = url.searchParams.get("forceBuy") || undefined;
    const forceBidPrice = url.searchParams.get("forceBidPrice") || undefined;
    const forceAskPrice = url.searchParams.get("forceAskPrice") || undefined;
    const forceRecipe = url.searchParams.get("forceRecipe") || undefined;
    const excludeRecipe = url.searchParams.get("excludeRecipe") || undefined;

    // Extract extraction mode flag (ANT only)
    const extractionMode = url.searchParams.get("extractionMode") === "true";

    const report = await buildReport({ ticker, exchange, priceType, forceMake, forceBuy, forceBidPrice, forceAskPrice, forceRecipe, excludeRecipe, extractionMode });
    // buildReport signals in-band failures via `error` (bad ticker, missing
    // prices, constraint validation) — surface those as 422, not 200
    const status = (report as any)?.error ? 422 : 200;

    // Add explicit cache-busting headers to prevent any response caching
    return NextResponse.json(report, { status, headers: NO_CACHE_HEADERS });
  } catch (err: any) {
    return NextResponse.json(
      { schemaVersion: 3, ok: false, error: String(err?.message ?? err) },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}

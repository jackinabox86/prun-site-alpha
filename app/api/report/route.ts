// app/api/report/route.ts
import { NextResponse } from "next/server";
import { buildReport } from "@/server/report";
import type { PriceMode, Exchange, PriceType } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") ?? "CBS").toUpperCase();

    // Support new exchange + priceType parameters
    const exchange = (url.searchParams.get("exchange") ?? "ANT") as Exchange;
    const priceType = (url.searchParams.get("priceType") ?? "bid") as PriceType;
    const priceSource = (url.searchParams.get("priceSource") ?? "local") as "local" | "gcs";

    // Extract force make/buy constraints
    const forceMake = url.searchParams.get("forceMake") || undefined;
    const forceBuy = url.searchParams.get("forceBuy") || undefined;
    const forceBidPrice = url.searchParams.get("forceBidPrice") || undefined;
    const forceAskPrice = url.searchParams.get("forceAskPrice") || undefined;
    const forceRecipe = url.searchParams.get("forceRecipe") || undefined;
    const excludeRecipe = url.searchParams.get("excludeRecipe") || undefined;

    // Extract extraction mode flag (ANT only)
    const extractionMode = url.searchParams.get("extractionMode") === "true";

    const report = await buildReport({ ticker, exchange, priceType, priceSource, forceMake, forceBuy, forceBidPrice, forceAskPrice, forceRecipe, excludeRecipe, extractionMode });
    const status = (report as any)?.ok === false ? 500 : 200;

    // Add explicit cache-busting headers to prevent any response caching
    return NextResponse.json(report, {
      status,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (err: any) {
    return NextResponse.json(
      { schemaVersion: 3, ok: false, error: String(err?.message ?? err) },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
        }
      }
    );
  }
}

// app/api/best-recipes/route.ts
import { NextResponse } from "next/server";
import { cachedBestRecipes } from "@/server/cachedBestRecipes";
import type { Exchange } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300; // Allow up to 5 minutes for computation

const VALID_EXCHANGES: Exchange[] = ["ANT", "CIS", "ICA", "NCC", "UNV"];
const VALID_EXCHANGE_DISPLAYS = ["ANT", "CIS", "ICA", "NCC", "UNV7", "UNV30"];
const VALID_SELL_AT = ["bid", "ask", "pp7"];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clearCache = searchParams.get("clearCache") === "true";
    const priceSource = (searchParams.get("priceSource") || "gcs") as "local" | "gcs";
    const exchangeParam = searchParams.get("exchange")?.toUpperCase() || "ANT";
    const sellAtParam = searchParams.get("sellAt")?.toLowerCase() || "bid";

    // Validate exchange parameter - accept UNV7 and UNV30 as special cases
    const exchange = VALID_EXCHANGE_DISPLAYS.includes(exchangeParam)
      ? exchangeParam
      : "ANT";

    // Validate sellAt parameter
    const sellAt = VALID_SELL_AT.includes(sellAtParam) ? sellAtParam : "bid";

    if (clearCache) {
      console.log(`Clearing best recipes cache for ${exchange}...`);
      cachedBestRecipes.clearCache(exchange);
    }

    console.log(`Getting best recipes for ${exchange} with sellAt=${sellAt} (${priceSource} mode)...`);
    const startTime = Date.now();

    const { results } = await cachedBestRecipes.getBestRecipes(priceSource, exchange, sellAt);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Best recipes for ${exchange} with sellAt=${sellAt} retrieved in ${duration}s`);

    return NextResponse.json({
      success: true,
      data: results,
      count: results.length,
      exchange,
      sellAt,
      priceSource,
      cached: cachedBestRecipes.isCached(priceSource, exchange, sellAt),
      durationSeconds: parseFloat(duration)
    });
  } catch (err: any) {
    console.error("Error in best-recipes API:", err);
    return NextResponse.json(
      {
        success: false,
        error: String(err?.message ?? err),
        stack: process.env.NODE_ENV === "development" ? err?.stack : undefined
      },
      { status: 500 }
    );
  }
}

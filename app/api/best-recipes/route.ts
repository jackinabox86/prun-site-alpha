// app/api/best-recipes/route.ts
import { NextResponse } from "next/server";
import { cachedBestRecipes } from "@/server/cachedBestRecipes";
import type { Exchange } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300; // Allow up to 5 minutes for computation

const VALID_EXCHANGES: Exchange[] = ["ANT", "CIS", "ICA", "NCC", "UNV"];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clearCache = searchParams.get("clearCache") === "true";
    const priceSource = (searchParams.get("priceSource") || "gcs") as "local" | "gcs";
    const exchangeParam = searchParams.get("exchange")?.toUpperCase() || "ANT";

    // Validate exchange parameter
    const exchange = VALID_EXCHANGES.includes(exchangeParam as Exchange)
      ? (exchangeParam as Exchange)
      : "ANT";

    if (clearCache) {
      console.log(`Clearing best recipes cache for ${exchange}...`);
      cachedBestRecipes.clearCache(exchange);
    }

    console.log(`Getting best recipes for ${exchange} (${priceSource} mode)...`);
    const startTime = Date.now();

    const { results } = await cachedBestRecipes.getBestRecipes(priceSource, exchange);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Best recipes for ${exchange} retrieved in ${duration}s`);

    return NextResponse.json({
      success: true,
      data: results,
      count: results.length,
      exchange,
      priceSource,
      cached: cachedBestRecipes.isCached(priceSource, exchange),
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

// app/api/best-recipes/route.ts
import { NextResponse } from "next/server";
import { refreshBestRecipeIDs } from "@/server/bestRecipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300; // Allow up to 5 minutes for computation

export async function GET() {
  try {
    console.log("Starting best recipes calculation...");
    const startTime = Date.now();

    const results = await refreshBestRecipeIDs();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Best recipes calculation completed in ${duration}s`);

    return NextResponse.json({
      success: true,
      data: results,
      count: results.length,
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

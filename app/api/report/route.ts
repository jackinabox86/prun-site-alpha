import { NextResponse } from "next/server";
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { findAllMakeOptions, buildScenarioRows } from "@/core/engine";
import { computeRoiNarrow } from "@/core/roi"; // <-- added
import type { PriceMode, BestMap } from "@/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? "PCB").toUpperCase();
  const priceMode = (url.searchParams.get("priceMode") ?? "bid") as PriceMode;

  const { recipeMap, pricesMap, bestMap } = await loadAllFromCsv({
    recipes: process.env.CSV_RECIPES_URL!,
    prices:  process.env.CSV_PRICES_URL!,
    best:    process.env.CSV_BEST_URL!,
  });

  // bestMap is already the correct type (no casting needed)
  const options = findAllMakeOptions(ticker, recipeMap, pricesMap, priceMode, bestMap);

  // rank/format etc... (unchanged)
  const dailyCapacity = (options[0]?.output1Amount ?? 0) * (options[0]?.runsPerDay ?? 0);
  const ranked = options
    .map(o => ({ o, r: buildScenarioRows(o, 0, dailyCapacity, false) }))
    .sort((a, b) => (b.r.subtreeProfitPerArea ?? 0) - (a.r.subtreeProfitPerArea ?? 0));

  // NEW: ROI (narrow) for the parent stage = AllBuildCst / baseProfitPerDay
  const bestOption = ranked[0]?.o;
  const roi = bestOption ? computeRoiNarrow(bestOption) : null;

  return NextResponse.json({
    ticker,
    totalOptions: ranked.length,
    bestPA: ranked[0]?.r.subtreeProfitPerArea ?? null,
    bestScenario: ranked[0]?.o.scenario ?? "",
    // Added field; everything else unchanged
    roi: roi ? {
      narrowDays: roi.narrowDays, // number | null (payback period in days)
      capex: roi.capex,           // AllBuildCst for the parent stage
      basis: roi.basis,           // "baseProfitPerDay"
    } : null,
  });
}

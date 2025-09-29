// app/api/report/route.ts
import { NextResponse } from "next/server";
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { findAllMakeOptions, buildScenarioRows } from "@/core/engine";
import { computeRoiNarrow } from "@/core/roi";
import { computeInputPayback } from "@/core/inputPayback";
import type { PriceMode } from "@/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? "PCB").toUpperCase();
  const priceMode = (url.searchParams.get("priceMode") ?? "bid") as PriceMode;
  const expand = url.searchParams.get("expand") === "1"; // keep your tip working

  const { recipeMap, pricesMap, bestMap } = await loadAllFromCsv({
    recipes: process.env.CSV_RECIPES_URL!,
    prices:  process.env.CSV_PRICES_URL!,
    best:    process.env.CSV_BEST_URL!,
  });

  // Build all root options
  const options = findAllMakeOptions(ticker, recipeMap, pricesMap, priceMode, bestMap);
  if (!options.length) {
    return NextResponse.json({
      ticker,
      priceMode,
      totalOptions: 0,
      bestPA: null,
      bestScenario: "",
      best: null,
      top5: []
    });
  }

  // Rank by Profit/Area (computed at capacity basis)
  const ranked = options.map(o => {
    const capacity = (o.output1Amount || 0) * (o.runsPerDay || 0);
    const r = buildScenarioRows(o, 0, capacity, false); // summary calc only
    return { o, r, capacity };
  }).sort((a, b) => (b.r.subtreeProfitPerArea ?? 0) - (a.r.subtreeProfitPerArea ?? 0));

  // Best (expanded): rows already include ROI (narrow) from engine.ts
  const best = ranked[0];
  const bestRowsRes = buildScenarioRows(best.o, 0, best.capacity, expand);
  const bestRows = bestRowsRes.rows.slice();

  // Append Input Payback only to BEST
  const ip = computeInputPayback(best.o, 7);
  bestRows.push(["Input Payback (7d buffer) [days]:", ip.days ?? "n/a"]);

  // Top 5 summary: attach numeric ROI but do NOT add Input Payback
  const top5 = ranked.slice(0, 5).map(({ o, r }) => {
    const roi = computeRoiNarrow(o);
    return {
      ...o,
      // surface the computed PA/area from the rows result
      totalProfitPA: r.subtreeProfitPerArea ?? 0,
      totalAreaPerDay: r.subtreeAreaPerDay ?? 0,
      // NEW: numeric field so it shows up in your "Top 5 (summary only)" block
      roiNarrowDays: roi.narrowDays, // number | null
    };
  });

  return NextResponse.json({
    ticker,
    priceMode,
    totalOptions: ranked.length,
    bestPA: best.r.subtreeProfitPerArea ?? null,
    bestScenario: best.o.scenario ?? "",
    // Best scenario (full object + rows)
    best: {
      ...best.o,
      rows: bestRows
    },
    // Top 5 summary (each now includes roiNarrowDays)
    top5
  });
}

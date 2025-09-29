// app/api/report/route.ts
import { NextResponse } from "next/server";
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { findAllMakeOptions, buildScenarioRows } from "@/core/engine";
import { computeRoiNarrow } from "@/core/roi";
import { computeInputPayback } from "@/core/inputPayback";
import type { PriceMode } from "@/types";

export const runtime = "nodejs";

// (Optional) a response-only type so we can safely add metrics onto raw options
type WithMetrics<T> = T & {
  roiNarrowDays?: number | null;
  inputPaybackDays7?: number | null;
  totalProfitPA?: number;     // already computed from rows
  totalAreaPerDay?: number;   // already computed from rows
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? "PCB").toUpperCase();
  const priceMode = (url.searchParams.get("priceMode") ?? "bid") as PriceMode;
  const expand = url.searchParams.get("expand") === "1";

  const { recipeMap, pricesMap, bestMap } = await loadAllFromCsv({
    recipes: process.env.CSV_RECIPES_URL!,
    prices:  process.env.CSV_PRICES_URL!,
    best:    process.env.CSV_BEST_URL!,
  });

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

  // Rank by Profit/Area (capacity basis)
  const ranked = options.map(o => {
    const capacity = (o.output1Amount || 0) * (o.runsPerDay || 0);
    const r = buildScenarioRows(o, 0, capacity, false);
    return { o, r, capacity };
  }).sort((a, b) => (b.r.subtreeProfitPerArea ?? 0) - (a.r.subtreeProfitPerArea ?? 0));

  // Best (expanded rows)
  const best = ranked[0];
  const bestRowsRes = buildScenarioRows(best.o, 0, best.capacity, expand);
  const bestRows = bestRowsRes.rows.slice();

  // Keep the row-annotations (for the human-readable block)
  const roi = computeRoiNarrow(best.o);
  const ip  = computeInputPayback(best.o, 7);
  // rows already include ROI (narrow) in engine.ts root; we add Input Payback here:
  bestRows.push(["Input Payback (7d buffer) [days]:", ip.days ?? "n/a"]);

  // ALSO attach numeric metrics directly on the raw best option
  const bestRaw: WithMetrics<typeof best.o> = {
    ...best.o,
    totalProfitPA: best.r.subtreeProfitPerArea ?? 0,
    totalAreaPerDay: best.r.subtreeAreaPerDay ?? 0,
    roiNarrowDays: roi.narrowDays,
    inputPaybackDays7: ip.days
  };

  // Top 5 summary: attach ROI but NOT input payback (per your choice)
  const top5: Array<WithMetrics<typeof ranked[number]["o"]>> = ranked.slice(0, 5).map(({ o, r }) => {
    const roi = computeRoiNarrow(o);
    return {
      ...o,
      totalProfitPA: r.subtreeProfitPerArea ?? 0,
      totalAreaPerDay: r.subtreeAreaPerDay ?? 0,
      roiNarrowDays: roi.narrowDays
      // (deliberately NOT including inputPaybackDays7 here)
    };
  });

  return NextResponse.json({
    ticker,
    priceMode,
    totalOptions: ranked.length,
    bestPA: best.r.subtreeProfitPerArea ?? null,
    bestScenario: best.o.scenario ?? "",
    // Best: raw enriched + rows
    best: {
      ...bestRaw,
      rows: bestRows
    },
    top5
  });
}

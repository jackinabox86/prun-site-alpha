// app/api/report/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { findAllMakeOptions, buildScenarioRows } from "@/core/engine";
import { computeRoiNarrow } from "@/core/roi";
import { computeInputPayback } from "@/core/inputPayback";
import type { PriceMode } from "@/types";

// response-only helper to tack metrics onto raw options
type WithMetrics<T> = T & {
  roiNarrowDays?: number | null;
  inputPaybackDays7?: number | null;
  totalProfitPA?: number;
  totalAreaPerDay?: number;
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
      schemaVersion: 3,
      ticker,
      priceMode,
      totalOptions: 0,
      bestPA: null,
      bestScenario: "",
      best: null,
      top5: []
    });
  }

  // Rank by Profit/Area at capacity
  const ranked = options
    .map(o => {
      const capacity = (o.output1Amount || 0) * (o.runsPerDay || 0);
      const r = buildScenarioRows(o, 0, capacity, false);
      return { o, r, capacity };
    })
    .sort((a, b) => (b.r.subtreeProfitPerArea ?? 0) - (a.r.subtreeProfitPerArea ?? 0));

  // Best (expanded rows)
  const best = ranked[0];
  const bestRowsRes = buildScenarioRows(best.o, 0, best.capacity, expand);
  const bestRows = bestRowsRes.rows.slice();

  // Compute numeric metrics
  const roi = computeRoiNarrow(best.o);          // { narrowDays, capex, basis }
  const ip  = computeInputPayback(best.o, 7);    // { days, windowDays }

  // Append Input Payback label to human-readable rows (ROI row already added in engine.ts)
  bestRows.push(["Input Payback (7d buffer) [days]:", ip.days ?? "n/a"]);

  // Enrich BEST raw object with metrics
  const bestRaw: WithMetrics<typeof best.o> = {
    ...best.o,
    totalProfitPA: best.r.subtreeProfitPerArea ?? 0,
    totalAreaPerDay: best.r.subtreeAreaPerDay ?? 0,
    roiNarrowDays: roi.narrowDays ?? null,
    inputPaybackDays7: ip.days ?? null,
  };

  // Top 5 summary: include ROI (per your choice, omit input payback)
  const top5: Array<WithMetrics<typeof ranked[number]["o"]>> = ranked.slice(0, 5).map(({ o, r }) => {
    const roi = computeRoiNarrow(o);
    return {
      ...o,
      totalProfitPA: r.subtreeProfitPerArea ?? 0,
      totalAreaPerDay: r.subtreeAreaPerDay ?? 0,
      roiNarrowDays: roi.narrowDays ?? null,
    };
  });

  return NextResponse.json({
    schemaVersion: 3,
    ticker,
    priceMode,
    totalOptions: ranked.length,
    bestPA: best.r.subtreeProfitPerArea ?? null,
    bestScenario: best.o.scenario ?? "",
    best: {
      ...bestRaw,     // <-- raw metrics live here
      rows: bestRows, // <-- human-readable block (also contains ROI/IP labels)
    },
    top5
  });
}

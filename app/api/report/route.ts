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

type WithMetrics<T> = T & {
  roiNarrowDays?: number | null;
  inputPaybackDays7?: number | null;
  totalProfitPA?: number;
  totalAreaPerDay?: number;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") ?? "PCB").toUpperCase();
    const priceMode = (url.searchParams.get("priceMode") ?? "bid") as PriceMode;
    const expand = url.searchParams.get("expand") === "1";

    // Guard env vars early so we don’t throw deep inside loaders
    const REC = process.env.CSV_RECIPES_URL;
    const PRI = process.env.CSV_PRICES_URL;
    const BST = process.env.CSV_BEST_URL;
    if (!REC || !PRI || !BST) {
      return NextResponse.json(
        {
          schemaVersion: 3,
          ok: false,
          error: "Missing CSV_* env vars",
          missing: {
            CSV_RECIPES_URL: !!REC,
            CSV_PRICES_URL: !!PRI,
            CSV_BEST_URL: !!BST,
          },
        },
        { status: 500 }
      );
    }

    const { recipeMap, pricesMap, bestMap } = await loadAllFromCsv({
      recipes: REC,
      prices: PRI,
      best: BST,
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

    // Metrics
    const roi = computeRoiNarrow(best.o);          // { narrowDays, capex, basis }
    const ip  = computeInputPayback(best.o, 7);    // { days, windowDays }

    // Add Input Payback label to human-readable rows (ROI row already added in engine.ts)
    bestRows.push(["Input Payback (7d buffer) [days]:", ip.days ?? "n/a"]);

    // Enrich BEST raw object with numeric fields (so UI can show them outside rows)
    const bestRaw: WithMetrics<typeof best.o> = {
      ...best.o,
      totalProfitPA: best.r.subtreeProfitPerArea ?? 0,
      totalAreaPerDay: best.r.subtreeAreaPerDay ?? 0,
      roiNarrowDays: roi.narrowDays ?? null,
      inputPaybackDays7: ip.days ?? null,
    };

    // Top 5 summary: include ROI (omit input payback as you requested)
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
        ...bestRaw,     // raw metrics here
        rows: bestRows, // human-readable block (also includes ROI/IP labels)
      },
      top5
    });
  } catch (err: any) {
    // Never crash the route. Log and return JSON so the page can render an error.
    console.error("[/api/report] FAILED:", err?.stack || err);
    return NextResponse.json(
      {
        schemaVersion: 3,
        ok: false,
        error: String(err?.message ?? err),
      },
      { status: 500 }
    );
  }
}

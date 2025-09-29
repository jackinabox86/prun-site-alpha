// src/server/report.ts
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

export async function buildReport(opts: {
  ticker: string;
  priceMode: PriceMode;
  expand: boolean;      // controls child expansion in rows (if rows are requested)
  includeRows?: boolean; // <-- NEW: return human-readable rows only if true
}) {
  const { ticker, priceMode, expand, includeRows = false } = opts;

  const REC = process.env.CSV_RECIPES_URL;
  const PRI = process.env.CSV_PRICES_URL;
  const BST = process.env.CSV_BEST_URL;
  if (!REC || !PRI || !BST) {
    return {
      schemaVersion: 3,
      ok: false,
      error: "Missing CSV_* env vars",
      missing: {
        CSV_RECIPES_URL: !!REC,
        CSV_PRICES_URL: !!PRI,
        CSV_BEST_URL: !!BST,
      },
    };
  }

  const { recipeMap, pricesMap, bestMap } = await loadAllFromCsv({
    recipes: REC,
    prices:  PRI,
    best:    BST,
  });

  const options = findAllMakeOptions(ticker, recipeMap, pricesMap, priceMode, bestMap);
  if (!options.length) {
    return {
      schemaVersion: 3,
      ticker,
      priceMode,
      totalOptions: 0,
      bestPA: null,
      bestScenario: "",
      best: null,
      top5: [],
    };
  }

  // Rank by Profit/Area at capacity
  const ranked = options
    .map(o => {
      const capacity = (o.output1Amount || 0) * (o.runsPerDay || 0);
      const r = buildScenarioRows(o, 0, capacity, false); // used for PA/area math only
      return { o, r, capacity };
    })
    .sort((a, b) => (b.r.subtreeProfitPerArea ?? 0) - (a.r.subtreeProfitPerArea ?? 0));

  // Best
  const best = ranked[0];

  // Numeric metrics for BEST (go on the raw object)
  const roi = computeRoiNarrow(best.o);       // { narrowDays, capex, basis }
  const ip  = computeInputPayback(best.o, 7); // { days, windowDays }

  const bestRaw: WithMetrics<typeof best.o> = {
    ...best.o,
    totalProfitPA: best.r.subtreeProfitPerArea ?? 0,
    totalAreaPerDay: best.r.subtreeAreaPerDay ?? 0,
    roiNarrowDays: roi.narrowDays ?? null,
    inputPaybackDays7: ip.days ?? null,
  };

  // Only build/return human-readable rows if requested
  let bestRows: [string, number | string][] | undefined = undefined;
  if (includeRows) {
    const bestRowsRes = buildScenarioRows(best.o, 0, best.capacity, expand);
    bestRows = bestRowsRes.rows.slice();
    // The engine already adds ROI (narrow). We add Input Payback label here:
    bestRows.push(["Input Payback (7d buffer) [days]:", ip.days ?? "n/a"]);
  }

  // Top 5 summary: include ROI only (no rows here)
  const top5: Array<WithMetrics<typeof ranked[number]["o"]>> = ranked.slice(0, 5).map(({ o, r }) => {
    const roi = computeRoiNarrow(o);
    return {
      ...o,
      totalProfitPA: r.subtreeProfitPerArea ?? 0,
      totalAreaPerDay: r.subtreeAreaPerDay ?? 0,
      roiNarrowDays: roi.narrowDays ?? null,
    };
  });

  return {
    schemaVersion: 3,
    ticker,
    priceMode,
    totalOptions: ranked.length,
    bestPA: best.r.subtreeProfitPerArea ?? null,
    bestScenario: best.o.scenario ?? "",
    best: includeRows ? { ...bestRaw, rows: bestRows } : bestRaw,
    top5,
  };
}

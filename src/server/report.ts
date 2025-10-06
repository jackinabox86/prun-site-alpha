// src/server/report.ts
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { findAllMakeOptions, buildScenarioRows } from "@/core/engine";
import { computeRoiNarrow, computeRoiBroad } from "@/core/roi";
import { computeInputPayback } from "@/core/inputPayback";
import { CSV_URLS } from "@/lib/config";
import type { PriceMode } from "@/types";

type WithMetrics<T> = T & {
  roiNarrowDays?: number | null;
  roiBroadDays?: number | null;
  inputPaybackDays7Narrow?: number | null;
  inputPaybackDays7Broad?: number | null;
  totalProfitPA?: number;
  totalAreaPerDay?: number;
  totalBuildCost?: number;
  totalInputBuffer7?: number;
};

export async function buildReport(opts: {
  ticker: string;
  priceMode: PriceMode;
}) {
  const { ticker, priceMode } = opts;

  const { recipeMap, pricesMap, bestMap } = await loadAllFromCsv(CSV_URLS);

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
      top20: [],
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
  const baseProfitPerDay = best.o.baseProfitPerDay ?? 0;
  const totalBuildCost = best.r.subtreeBuildCost ?? 0;
  const roiBroad = computeRoiBroad(totalBuildCost, baseProfitPerDay);
  const ip  = computeInputPayback(best.o, 7); // { days, windowDays }

  // Input buffer payback: narrow = self only, broad = entire tree
  const inputBuffer7Narrow = best.o.inputBuffer7 ?? 0;
  const inputBuffer7Broad = best.r.subtreeInputBuffer7 ?? 0;
  const inputPaybackNarrow = baseProfitPerDay > 0 ? inputBuffer7Narrow / baseProfitPerDay : null;
  const inputPaybackBroad = baseProfitPerDay > 0 ? inputBuffer7Broad / baseProfitPerDay : null;

  const bestRaw: WithMetrics<typeof best.o> = {
    ...best.o,
    totalProfitPA: best.r.subtreeProfitPerArea ?? 0,
    totalAreaPerDay: best.r.subtreeAreaPerDay ?? 0,
    totalBuildCost: totalBuildCost,
    totalInputBuffer7: best.r.subtreeInputBuffer7 ?? 0,
    roiNarrowDays: roi.narrowDays ?? null,
    roiBroadDays: roiBroad.broadDays ?? null,
    inputPaybackDays7Narrow: inputPaybackNarrow,
    inputPaybackDays7Broad: inputPaybackBroad,
  };


  // Top 20 summary: include ROI only (no rows here)
  const top20: Array<WithMetrics<typeof ranked[number]["o"]>> = ranked.slice(0, 20).map(({ o, r }) => {
    const roi = computeRoiNarrow(o);
    const baseProfitPerDay = o.baseProfitPerDay ?? 0;
    const totalBuildCost = r.subtreeBuildCost ?? 0;
    const roiBroad = computeRoiBroad(totalBuildCost, baseProfitPerDay);

    // Input buffer payback: narrow = self only, broad = entire tree
    const inputBuffer7Narrow = o.inputBuffer7 ?? 0;
    const inputBuffer7Broad = r.subtreeInputBuffer7 ?? 0;
    const inputPaybackNarrow = baseProfitPerDay > 0 ? inputBuffer7Narrow / baseProfitPerDay : null;
    const inputPaybackBroad = baseProfitPerDay > 0 ? inputBuffer7Broad / baseProfitPerDay : null;

    return {
      ...o,
      totalProfitPA: r.subtreeProfitPerArea ?? 0,
      totalAreaPerDay: r.subtreeAreaPerDay ?? 0,
      totalBuildCost: totalBuildCost,
      totalInputBuffer7: r.subtreeInputBuffer7 ?? 0,
      roiNarrowDays: roi.narrowDays ?? null,
      roiBroadDays: roiBroad.broadDays ?? null,
      inputPaybackDays7Narrow: inputPaybackNarrow,
      inputPaybackDays7Broad: inputPaybackBroad,
    };
  });

  return {
    schemaVersion: 3,
    ticker,
    priceMode,
    totalOptions: ranked.length,
    bestPA: best.r.subtreeProfitPerArea ?? null,
    bestScenario: best.o.scenario ?? "",
    best: bestRaw,
    top20,
  };
}

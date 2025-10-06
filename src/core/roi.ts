// src/core/roi.ts
import type { MakeOption } from "@/types";

/**
 * ROI (narrow) in DAYS for the parent stage:
 *   paybackDays = AllBuildCst / baseProfitPerDay
 *
 * baseProfitPerDay fallback is computed if not present.
 * Returns null if capex is 0 or profit <= 0 (no meaningful payback).
 */
export function computeRoiNarrow(option: MakeOption): {
  narrowDays: number | null;
  capex: number;
  basis: "baseProfitPerDay";
} {
  const capex = option.buildCost || 0;

  // Prefer the engine's precomputed value; else compute capacity-basis fallback
  const baseProfitPerDay =
    option.baseProfitPerDay ??
    ((option.baseProfitPerOutput || 0) *
      (option.output1Amount || 0) *
      (option.runsPerDay || 0));

  if (!capex || !Number.isFinite(baseProfitPerDay) || baseProfitPerDay <= 0) {
    return { narrowDays: null, capex, basis: "baseProfitPerDay" };
  }
  return {
    narrowDays: capex / baseProfitPerDay,
    capex,
    basis: "baseProfitPerDay",
  };
}

/**
 * ROI (broad) in DAYS:
 *   paybackDays = totalBuildCost / baseProfitPerDay
 *
 * This includes the cumulative build cost from all stages in the production chain.
 * Returns null if total build cost is 0 or profit <= 0 (no meaningful payback).
 */
export function computeRoiBroad(
  totalBuildCost: number,
  baseProfitPerDay: number
): {
  broadDays: number | null;
  totalBuildCost: number;
  basis: "baseProfitPerDay";
} {
  if (!totalBuildCost || !Number.isFinite(baseProfitPerDay) || baseProfitPerDay <= 0) {
    return { broadDays: null, totalBuildCost, basis: "baseProfitPerDay" };
  }
  return {
    broadDays: totalBuildCost / baseProfitPerDay,
    totalBuildCost,
    basis: "baseProfitPerDay",
  };
}

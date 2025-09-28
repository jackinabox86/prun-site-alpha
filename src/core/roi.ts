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
 * Placeholder for future “ROI (broad)”
 * Intentionally not implemented yet.
 */
export interface RoiBroadInputs {
  // e.g. sum children/grandchildren capex when MAKE branches are taken
  // Keep for future expansion; unused for now.
}

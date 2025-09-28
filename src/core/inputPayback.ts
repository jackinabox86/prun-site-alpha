// src/core/inputPayback.ts
import type { MakeOption } from "@/types";

export function computeInputPayback(option: MakeOption, windowDays = 7) {
  const costPerRun = option.cost || 0;              // inputs only
  const workforcePerRun = option.workforceCost || 0; // exclude depreciation
  const runsPerDay = option.runsPerDay || 0;

  // Base profit/day (same basis as ROI)
  const baseProfitPerDay =
    option.baseProfitPerDay ??
    ((option.baseProfitPerOutput || 0) *
      (option.output1Amount || 0) *
      (option.runsPerDay || 0));

  const bufferSpend = windowDays * ((costPerRun + workforcePerRun) * runsPerDay);

  if (!Number.isFinite(baseProfitPerDay) || baseProfitPerDay <= 0) {
    return { days: null, windowDays, basis: "baseProfitPerDay" as const };
  }
  return {
    days: bufferSpend / baseProfitPerDay,
    windowDays,
    basis: "baseProfitPerDay" as const,
  };
}

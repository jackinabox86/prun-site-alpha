// src/core/inputPayback.ts
import type { MakeOption } from "@/types";

/**
 * Input Payback = (windowDays * ((cost + workforceCost) * runsPerDay)) / baseProfitPerDay
 * - Uses base profit (not adjusted) for the denominator.
 * - Ignores depreciation per your definition.
 */
export function computeInputPayback(
  option: MakeOption,
  windowDays = 7
): { days: number | null; windowDays: number } {
  // baseProfitPerDay is on MakeOption; if missing, derive it from per-output metrics
  const baseProfitPerDay =
    option.baseProfitPerDay ??
    ((option.baseProfitPerOutput || 0) *
      (option.output1Amount || 0) *
      (option.runsPerDay || 0));

  const runsPerDay = option.runsPerDay || 0;
  const dailyBufferCost = (option.cost + (option.workforceCost || 0)) * runsPerDay;

  if (!baseProfitPerDay || baseProfitPerDay <= 0) {
    return { days: null, windowDays };
  }

  return {
    days: (windowDays * dailyBufferCost) / baseProfitPerDay,
    windowDays,
  };
}

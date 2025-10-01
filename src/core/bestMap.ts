import type { BestMap } from "@/types";

function normalizeScenarioText(s: string): string {
  // collapse whitespace, normalize ", " and "[ ... ]" spacing
  // also strip legacy "(for X)" patterns to support old CSV format during transition
  return s
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\[\s*/g, " [")
    .replace(/\s*\]\s*/g, "]")
    .replace(/\s*\(for\s+[A-Z0-9_]+\)/gi, "") // strip "(for TICKER)" patterns
    .trim();
}

export function readBestRecipeMap(rows: Array<Record<string, any>>): BestMap {
  if (!rows?.length) return {};

  const hasScenario = "Scenario" in rows[0];
  const hasPA = "Profit P/A" in rows[0];
  const idKey =
    "BestRecipeID" in rows[0]
      ? "BestRecipeID"
      : "RecipeID" in rows[0]
      ? "RecipeID"
      : null;
  if (!idKey) throw new Error("BestRecipeIDs needs BestRecipeID or RecipeID");

  const bestByTicker: Record<string, Record<string, any>> = {};
  for (const r of rows) {
    const t = r["Ticker"];
    if (!t) continue;
    if (!bestByTicker[t]) {
      bestByTicker[t] = r;
      continue;
    }
    if (hasPA) {
      const a = Number(bestByTicker[t]["Profit P/A"]);
      const b = Number(r["Profit P/A"]);
      if (Number.isFinite(b) && (!Number.isFinite(a) || b > a)) bestByTicker[t] = r;
    }
  }

  const out: BestMap = {};
  for (const [t, r] of Object.entries(bestByTicker)) {
    const rawScenario = hasScenario ? String(r["Scenario"] ?? "") : "";
    out[t] = {
      recipeId: r[idKey] ?? null,
      scenario: normalizeScenarioText(rawScenario),
    };
  }
  return out;
}

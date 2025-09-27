import type { BestMap, BestMapEntry } from "@/types";

export function readBestRecipeMap(rows: Array<Record<string, any>>): BestMap {
  if (!rows?.length) return {};
  const hasScenario = "Scenario" in rows[0];
  const hasPA = "Profit P/A" in rows[0];
  const idKey = "BestRecipeID" in rows[0] ? "BestRecipeID" : ("RecipeID" in rows[0] ? "RecipeID" : null);
  if (!idKey) throw new Error("BestRecipeIDs needs BestRecipeID or RecipeID");

  const bestByTicker: Record<string, Record<string, any>> = {};
  for (const r of rows) {
    const t = r["Ticker"];
    if (!t) continue;
    if (!bestByTicker[t]) { bestByTicker[t] = r; continue; }
    if (hasPA) {
      const a = Number(bestByTicker[t]["Profit P/A"]);
      const b = Number(r["Profit P/A"]);
      if (Number.isFinite(b) && (!Number.isFinite(a) || b > a)) bestByTicker[t] = r;
    }
  }

  const out: BestMap = {};
  for (const [t, r] of Object.entries(bestByTicker)) {
    out[t] = {
      recipeId: r[idKey] ?? null,
      scenario: hasScenario ? String(r["Scenario"] ?? "") : "",
    };
  }
  return out;
}

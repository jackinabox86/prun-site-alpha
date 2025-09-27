// src/core/bestMap.ts
import type { BestMap, BestMapEntry } from "@/types";

/**
 * rows: Array of objects, e.g.
 * [{ Ticker:"PCB", RecipeID:"PCB-R1", Scenario:"Buy COP, Make SEN-R1 (for SEN)", "Profit P/A":1.234 }, ...]
 */
export function readBestRecipeMap(rows: Array<Record<string, any>>): BestMap {
  if (!rows?.length) return {};

  const headers = Object.keys(rows[0] ?? {});
  if (!headers.includes("Ticker")) throw new Error("BestRecipeIDs CSV is missing 'Ticker'");

  const idKey =
    headers.includes("BestRecipeID") ? "BestRecipeID" :
    headers.includes("RecipeID")     ? "RecipeID"     : null;
  if (!idKey) throw new Error("BestRecipeIDs needs BestRecipeID or RecipeID");

  const hasPA = headers.includes("Profit P/A");
  const hasScenario = headers.includes("Scenario");

  // Choose the single best row per ticker (by Profit P/A if present)
  const choose = (a: Record<string, any> | null, b: Record<string, any>) => {
    if (!a) return b;
    if (!hasPA) return a; // if no PA col, assume one row per ticker or keep first
    const paA = Number(a["Profit P/A"]);
    const paB = Number(b["Profit P/A"]);
    return (Number.isFinite(paB) && (!Number.isFinite(paA) || paB > paA)) ? b : a;
  };

  const bestRowByTicker: Record<string, Record<string, any>> = {};
  for (const r of rows) {
    const t = r["Ticker"];
    if (!t) continue;
    bestRowByTicker[t] = choose(bestRowByTicker[t] ?? null, r);
  }

  const bestMap: BestMap = {};
  for (const [t, r] of Object.entries(bestRowByTicker)) {
    const entry: BestMapEntry = {
      recipeId: r[idKey] ?? null,
      scenario: hasScenario ? String(r["Scenario"] ?? "") : "", // may be empty if sheet lacks Scenario col
    };
    bestMap[t] = entry;
  }
  return bestMap;
}

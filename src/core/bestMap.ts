// src/core/bestMap.ts
import { BestMap } from "@/types";

// Expects array of objects like: [{ Ticker:"PE", BestRecipeID:"PE1", "Profit P/A": 1.23 }, ...]
export function readBestRecipeMap(rows: Array<Record<string, any>>): BestMap {
  if (!rows?.length) return {};

  const headers = Object.keys(rows[0] ?? {});
  const hasTicker = headers.includes("Ticker");
  if (!hasTicker) throw new Error("BestRecipeIDs CSV is missing 'Ticker' header");

  const idKey = headers.includes("BestRecipeID")
    ? "BestRecipeID"
    : headers.includes("RecipeID")
      ? "RecipeID"
      : null;
  if (!idKey) throw new Error("BestRecipeIDs CSV needs BestRecipeID or RecipeID header");

  const hasPA = headers.includes("Profit P/A");
  const best: BestMap = {};

  if (hasPA) {
    const byTicker: Record<string, { rid: string; pa: number }> = {};
    for (const r of rows) {
      const t = r["Ticker"];
      const rid = r[idKey];
      const pa = Number(r["Profit P/A"]);
      if (!t || !rid) continue;
      if (!byTicker[t] || (Number.isFinite(pa) && pa > byTicker[t].pa)) {
        byTicker[t] = { rid, pa };
      }
    }
    for (const [t, v] of Object.entries(byTicker)) best[t] = v.rid;
    return best;
  }

  for (const r of rows) {
    const t = r["Ticker"];
    const rid = r[idKey];
    if (t && rid) best[t] = rid;
  }
  return best;
}

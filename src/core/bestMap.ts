import { BestMap } from "../types";

/**
 * rows[0] must be headers. Subsequent rows are data objects keyed by those headers.
 * If you read from CSV/Sheets, normalize each row to a { [header]: value } object first.
 */
export function readBestRecipeMap(rows: Array<Record<string, any>>): BestMap {
  if (!rows?.length) throw new Error("BestRecipeIDs: no rows provided");

  const headers = Object.keys(rows[0] ?? {});
  const hasTicker = headers.includes("Ticker");
  if (!hasTicker) throw new Error("BestRecipeIDs: missing 'Ticker' column");

  const idKey = headers.includes("BestRecipeID")
    ? "BestRecipeID"
    : headers.includes("RecipeID")
      ? "RecipeID"
      : null;

  if (!idKey) throw new Error("BestRecipeIDs: missing BestRecipeID/RecipeID column");

  const hasPA = headers.includes("Profit P/A");
  const best: BestMap = {};

  if (hasPA) {
    // choose the row with highest Profit P/A per ticker
    const seen: Record<string, { rid: string; pa: number }> = {};
    for (const r of rows.slice(1)) {
      const t = r["Ticker"];
      const rid = r[idKey];
      const pa = r["Profit P/A"];
      if (!t || !rid) continue;
      if (!seen[t] || (typeof pa === "number" && pa > seen[t].pa)) {
        seen[t] = { rid, pa };
      }
    }
    for (const [t, v] of Object.entries(seen)) best[t] = v.rid;
    return best;
  }

  // no PA column: take the listed recipe id
  for (const r of rows.slice(1)) {
    const t = r["Ticker"];
    const rid = r[idKey];
    if (t && rid) best[t] = rid;
  }
  return best;
}

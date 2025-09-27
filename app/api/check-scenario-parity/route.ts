// app/api/check-scenario-parity/route.ts
import { NextResponse } from "next/server";
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { findAllMakeOptions } from "@/core/engine";
import { scenarioEquals, normalizeScenario } from "@/core/scenario";
import type { PriceMode } from "@/types";
import { CSV_URLS } from "@/lib/config"; // or swap for env-based object below

export const runtime = "nodejs";

export async function GET() {
  // If you prefer envs directly, replace CSV_URLS with:
  // {
  //   recipes: process.env.CSV_RECIPES_URL!,
  //   prices:  process.env.CSV_PRICES_URL!,
  //   best:    process.env.CSV_BEST_URL!,
  // }
  const { recipeMap, pricesMap, bestMap, __rawBestRows } = await loadAllFromCsv(CSV_URLS);

  const priceMode: PriceMode = "bid";
  const mismatches: Array<{ ticker: string; sheet: string; computed: string }> = [];

  // Walk the sheet's BestRecipeIDs rows and recompute each child's best scenario
  for (const r of __rawBestRows as Array<Record<string, any>>) {
    const t = String(r["Ticker"] ?? "").trim();
    const sheetScenario = String(r["Scenario"] ?? "").trim();
    if (!t) continue;

    // depth=1 → “child mode”: return exactly one best option for the ticker
    const best = findAllMakeOptions(t, recipeMap, pricesMap, priceMode, bestMap, 1)[0];
    const computed = best?.scenario ?? "";

    if (!scenarioEquals(sheetScenario, computed)) {
      mismatches.push({
        ticker: t,
        sheet: normalizeScenario(sheetScenario),
        computed: normalizeScenario(computed),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    totalChecked: (__rawBestRows as any[]).length || 0,
    mismatches,
  });
}

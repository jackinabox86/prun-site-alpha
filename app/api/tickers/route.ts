// app/api/tickers/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { loadAllFromCsv } from "@/lib/loadFromCsv";

export async function GET() {
  const REC = process.env.CSV_RECIPES_URL!;
  const PRI = process.env.CSV_PRICES_URL!;
  const BST = process.env.CSV_BEST_URL!;
  if (!REC || !PRI || !BST) {
    return NextResponse.json(
      { ok: false, error: "Missing CSV_* env vars" },
      { status: 500 }
    );
  }

  const { recipeMap } = await loadAllFromCsv({
    recipes: REC,
    prices:  PRI,
    best:    BST,
  });

  const tickers = Object.keys(recipeMap.map).sort();
  return NextResponse.json({ ok: true, tickers });
}

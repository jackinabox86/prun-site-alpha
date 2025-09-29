// app/api/tickers/route.ts
import { NextResponse } from "next/server";
import { loadAllFromCsv } from "@/lib/loadFromCsv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const REC = process.env.CSV_RECIPES_URL;
  const PRI = process.env.CSV_PRICES_URL;
  const BST = process.env.CSV_BEST_URL;

  if (!REC || !PRI || !BST) {
    return NextResponse.json({ tickers: [] }, { status: 200 });
  }

  try {
    const { recipeMap } = await loadAllFromCsv({
      recipes: REC,
      prices: PRI,
      best: BST,
    });

    const tickers = Object.keys(recipeMap.map || {}).sort((a, b) =>
      a.localeCompare(b)
    );

    return NextResponse.json({ tickers });
  } catch {
    return NextResponse.json({ tickers: [] }, { status: 200 });
  }
}

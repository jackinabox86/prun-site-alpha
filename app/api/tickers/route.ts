// app/api/tickers/route.ts
import { NextResponse } from "next/server";
import { loadAllFromCsv } from "@/lib/loadFromCsv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const REC = process.env.CSV_RECIPES_URL;
  const PRI = process.env.CSV_PRICES_URL;

  if (!REC || !PRI) {
    return NextResponse.json({ tickers: [] }, { status: 200 });
  }

  try {
    // Only need recipeMap, so we pass an empty bestMap to avoid generating it
    const { recipeMap } = await loadAllFromCsv(
      {
        recipes: REC,
        prices: PRI,
      },
      { bestMap: {} } // Pass empty bestMap since we don't need it for tickers
    );

    const tickers = Object.keys(recipeMap.map || {}).sort((a, b) =>
      a.localeCompare(b)
    );

    return NextResponse.json({ tickers });
  } catch {
    return NextResponse.json({ tickers: [] }, { status: 200 });
  }
}

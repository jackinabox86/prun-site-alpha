// app/api/report/route.ts
import { NextResponse } from "next/server";
import { buildReport } from "@/server/report";
import type { PriceMode, Exchange, PriceType } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") ?? "PCB").toUpperCase();

    // Support new exchange + priceType parameters
    const exchange = (url.searchParams.get("exchange") ?? "ANT") as Exchange;
    const priceType = (url.searchParams.get("priceType") ?? "bid") as PriceType;
    const priceSource = (url.searchParams.get("priceSource") ?? "local") as "local" | "gcs";

    const report = await buildReport({ ticker, exchange, priceType, priceSource });
    const status = (report as any)?.ok === false ? 500 : 200;
    return NextResponse.json(report, { status });
  } catch (err: any) {
    return NextResponse.json(
      { schemaVersion: 3, ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}

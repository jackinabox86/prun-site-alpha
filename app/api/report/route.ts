// app/api/report/route.ts
import { NextResponse } from "next/server";
import { buildReport } from "@/server/report";
import type { PriceMode } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") ?? "PCB").toUpperCase();
    const priceMode = (url.searchParams.get("priceMode") ?? "bid") as PriceMode;

    const report = await buildReport({ ticker, priceMode });
    const status = (report as any)?.ok === false ? 500 : 200;
    return NextResponse.json(report, { status });
  } catch (err: any) {
    return NextResponse.json(
      { schemaVersion: 3, ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}

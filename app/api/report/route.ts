// app/api/report/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { buildReport } from "@/server/report";
import type { PriceMode } from "@/types";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") ?? "PCB").toUpperCase();
    const priceMode = (url.searchParams.get("priceMode") ?? "bid") as PriceMode;
    const expand = url.searchParams.get("expand") === "1";
    const includeRows = url.searchParams.get("rows") === "1"; // <-- opt-in

    const report = await buildReport({ ticker, priceMode, expand, includeRows });
    const status = (report as any)?.ok === false ? 500 : 200;
    return NextResponse.json(report, { status });
  } catch (err: any) {
    console.error("[/api/report] FAILED:", err?.stack || err);
    return NextResponse.json(
      { schemaVersion: 3, ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}

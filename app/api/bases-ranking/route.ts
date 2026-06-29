import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRUNSTATS_RAW =
  "https://raw.githubusercontent.com/jackinabox86/prunstats-main/main/prunstats/www/data";

interface KnownCompany {
  Username: string;
  Corporation?: string;
}

interface BaseDataEntry {
  bases: number;
  rank: number;
}

export interface BasesRankingPublicRow {
  username: string;
  corporation: string | null;
  bases: number;
}

export interface BasesRankingPublicResponse {
  rows: BasesRankingPublicRow[];
  snapshotDate: string;
  error?: string;
}

export async function GET() {
  try {
    const [companiesRes, baseDataRes] = await Promise.all([
      fetch(`${PRUNSTATS_RAW}/knownCompanies.json`, { cache: "no-store" }),
      fetch(`${PRUNSTATS_RAW}/base-data-may26.json`, { cache: "no-store" }),
    ]);

    if (!companiesRes.ok || !baseDataRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch data from prunstats GitHub." } satisfies Partial<BasesRankingPublicResponse>,
        { status: 502 }
      );
    }

    const [knownCompanies, baseData]: [
      Record<string, KnownCompany>,
      Record<string, BaseDataEntry>
    ] = await Promise.all([companiesRes.json(), baseDataRes.json()]);

    const rows: BasesRankingPublicRow[] = [];

    for (const [hash, baseEntry] of Object.entries(baseData)) {
      if (!baseEntry || baseEntry.bases === 0) continue;
      const company = knownCompanies[hash];
      if (!company) continue;
      rows.push({
        username: company.Username,
        corporation: company.Corporation ?? null,
        bases: baseEntry.bases,
      });
    }

    return NextResponse.json({
      rows,
      snapshotDate: "May 2026",
    } satisfies BasesRankingPublicResponse);
  } catch (err) {
    console.error("bases-ranking error:", err);
    return NextResponse.json(
      { error: "Internal server error." } satisfies Partial<BasesRankingPublicResponse>,
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRUNSTATS_RAW =
  "https://raw.githubusercontent.com/jackinabox86/prunstats-main/main/prunstats/www/data";
const FNAR_API = "https://rest.fnar.net";

interface KnownCompany {
  Username: string;
  Corporation?: string;
}

interface BaseDataEntry {
  bases: number;
  rank: number;
}

interface FnarUser {
  UserName: string;
  CompanyName: string;
  CreatedEpochMs: number;
  [key: string]: unknown;
}

export interface BasesRankingRow {
  rank: number;
  username: string;
  companyName: string;
  corporation: string | null;
  bases: number;
  daysActive: number;
  daysPerBase: number;
}

export interface BasesRankingResponse {
  rows: BasesRankingRow[];
  snapshotDate: string;
  error?: string;
}

export async function GET() {
  try {
    const [companiesRes, baseDataRes, allUsersRes] = await Promise.all([
      fetch(`${PRUNSTATS_RAW}/knownCompanies.json`, { cache: "no-store" }),
      fetch(`${PRUNSTATS_RAW}/base-data-may26.json`, { cache: "no-store" }),
      fetch(`${FNAR_API}/user/allusers`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      }),
    ]);

    if (!companiesRes.ok || !baseDataRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch data from prunstats GitHub." } satisfies Partial<BasesRankingResponse>,
        { status: 502 }
      );
    }

    const [knownCompanies, baseData]: [
      Record<string, KnownCompany>,
      Record<string, BaseDataEntry>
    ] = await Promise.all([companiesRes.json(), baseDataRes.json()]);

    // Build a username → fnar user lookup (case-insensitive)
    const fnarByUsername = new Map<string, FnarUser>();
    if (allUsersRes.ok) {
      const fnarUsers: FnarUser[] = await allUsersRes.json();
      for (const u of fnarUsers) {
        if (u.UserName) {
          fnarByUsername.set(u.UserName.toLowerCase(), u);
        }
      }
    }

    const nowMs = Date.now();
    const rows: BasesRankingRow[] = [];

    for (const [hash, baseEntry] of Object.entries(baseData)) {
      if (!baseEntry || baseEntry.bases === 0) continue;

      const company = knownCompanies[hash];
      if (!company) continue;

      const username = company.Username;
      const fnarUser = fnarByUsername.get(username.toLowerCase());

      let daysActive = 0;
      let companyName = username;

      if (fnarUser) {
        companyName = fnarUser.CompanyName || username;
        if (fnarUser.CreatedEpochMs) {
          daysActive = Math.floor((nowMs - fnarUser.CreatedEpochMs) / (1000 * 60 * 60 * 24));
        }
      }

      if (daysActive <= 0) continue;

      rows.push({
        rank: 0,
        username,
        companyName,
        corporation: company.Corporation ?? null,
        bases: baseEntry.bases,
        daysActive,
        daysPerBase: daysActive / baseEntry.bases,
      });
    }

    // Sort by daysPerBase ascending (lower = more efficient)
    rows.sort((a, b) => a.daysPerBase - b.daysPerBase);
    rows.forEach((r, i) => { r.rank = i + 1; });

    return NextResponse.json({
      rows,
      snapshotDate: "May 2026",
    } satisfies BasesRankingResponse);
  } catch (err) {
    console.error("bases-ranking error:", err);
    return NextResponse.json(
      { error: "Internal server error." } satisfies Partial<BasesRankingResponse>,
      { status: 500 }
    );
  }
}

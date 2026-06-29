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
  UserName?: string;
  CompanyName?: string;
  // epoch ms or seconds — handle both
  CreatedEpochMs?: number;
  Created?: string | number;
  [key: string]: unknown;
}

export interface BasesRankingRow {
  rank: number;
  username: string;
  companyName: string;
  corporation: string | null;
  bases: number;
  daysActive: number | null;
  daysPerBase: number | null;
}

export interface BasesRankingResponse {
  rows: BasesRankingRow[];
  snapshotDate: string;
  fnarAvailable: boolean;
  error?: string;
}

function parseFnarEpochMs(u: FnarUser): number | null {
  if (u.CreatedEpochMs && u.CreatedEpochMs > 0) {
    // If value looks like seconds (< year 3000 in ms would be ~32503680000000)
    // Epoch ms for year 2020 = ~1577836800000; seconds = ~1577836800
    const v = u.CreatedEpochMs;
    return v < 1e12 ? v * 1000 : v;
  }
  if (u.Created) {
    if (typeof u.Created === "number") {
      const v = u.Created;
      return v < 1e12 ? v * 1000 : v;
    }
    if (typeof u.Created === "string") {
      const d = Date.parse(u.Created);
      return isNaN(d) ? null : d;
    }
  }
  return null;
}

export async function GET() {
  try {
    const [companiesRes, baseDataRes, allUsersRes] = await Promise.all([
      fetch(`${PRUNSTATS_RAW}/knownCompanies.json`, { cache: "no-store" }),
      fetch(`${PRUNSTATS_RAW}/base-data-may26.json`, { cache: "no-store" }),
      fetch(`${FNAR_API}/user/allusers`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      }).catch(() => null),
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
    const fnarAvailable = !!(allUsersRes && allUsersRes.ok);

    if (fnarAvailable && allUsersRes) {
      try {
        const fnarUsers: FnarUser[] = await allUsersRes.json();
        for (const u of fnarUsers) {
          const name = u.UserName;
          if (name) fnarByUsername.set(name.toLowerCase(), u);
        }
      } catch {
        // fnar payload unparseable — continue without it
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

      let daysActive: number | null = null;
      let companyName = username;

      if (fnarUser) {
        if (fnarUser.CompanyName) companyName = fnarUser.CompanyName;
        const epochMs = parseFnarEpochMs(fnarUser);
        if (epochMs !== null && epochMs > 0) {
          daysActive = Math.floor((nowMs - epochMs) / (1000 * 60 * 60 * 24));
          if (daysActive < 0) daysActive = null;
        }
      }

      rows.push({
        rank: 0,
        username,
        companyName,
        corporation: company.Corporation ?? null,
        bases: baseEntry.bases,
        daysActive,
        daysPerBase: daysActive !== null ? daysActive / baseEntry.bases : null,
      });
    }

    // Sort: rows with daysPerBase first (ascending), unknowns at the bottom
    rows.sort((a, b) => {
      if (a.daysPerBase === null && b.daysPerBase === null) return 0;
      if (a.daysPerBase === null) return 1;
      if (b.daysPerBase === null) return -1;
      return a.daysPerBase - b.daysPerBase;
    });
    rows.forEach((r, i) => { r.rank = i + 1; });

    return NextResponse.json({
      rows,
      snapshotDate: "May 2026",
      fnarAvailable,
    } satisfies BasesRankingResponse);
  } catch (err) {
    console.error("bases-ranking error:", err);
    return NextResponse.json(
      { error: "Internal server error." } satisfies Partial<BasesRankingResponse>,
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRUNSTATS_RAW =
  "https://raw.githubusercontent.com/jackinabox86/prunstats-main/main/prunstats/www/data";
const GCS_FIO_USERS =
  "https://storage.googleapis.com/prun-site-alpha-bucket/fio-user-data.csv";

interface KnownCompany {
  Username: string;
  Corporation?: string;
}

interface BaseDataEntry {
  bases: number;
  rank: number;
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
  fioDataDate: string | null;
  error?: string;
}

function parseCsvRows(csv: string): Map<string, { companyName: string; createdEpochMs: number | null }> {
  const map = new Map<string, { companyName: string; createdEpochMs: number | null }>();
  const lines = csv.split("\n");
  // skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Simple CSV parse — fields are: username, company_name, created_epoch_ms
    // company_name may be quoted
    let username: string, companyName: string, createdStr: string;
    if (line.startsWith('"')) {
      // quoted first field
      const closeQuote = line.indexOf('"', 1);
      username = line.slice(1, closeQuote);
      const rest = line.slice(closeQuote + 2); // skip closing quote + comma
      const nextComma = rest.lastIndexOf(",");
      companyName = rest.slice(0, nextComma);
      createdStr = rest.slice(nextComma + 1);
    } else {
      const parts = line.split(",");
      username = parts[0];
      createdStr = parts[parts.length - 1];
      companyName = parts.slice(1, parts.length - 1).join(",");
    }
    // Unquote company_name if quoted
    if (companyName.startsWith('"') && companyName.endsWith('"')) {
      companyName = companyName.slice(1, -1).replace(/""/g, '"');
    }
    const epochMs = createdStr ? parseInt(createdStr, 10) : NaN;
    map.set(username.toLowerCase(), {
      companyName: companyName || username,
      createdEpochMs: isNaN(epochMs) ? null : epochMs,
    });
  }
  return map;
}

export async function GET() {
  try {
    const [companiesRes, baseDataRes, fioRes] = await Promise.all([
      fetch(`${PRUNSTATS_RAW}/knownCompanies.json`, { cache: "no-store" }),
      fetch(`${PRUNSTATS_RAW}/base-data-may26.json`, { cache: "no-store" }),
      fetch(GCS_FIO_USERS, { cache: "no-store" }).catch(() => null),
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

    const fioMap = fioRes?.ok
      ? parseCsvRows(await fioRes.text())
      : new Map<string, { companyName: string; createdEpochMs: number | null }>();

    const fioDataDate = fioRes?.ok
      ? (fioRes.headers.get("Last-Modified") ?? null)
      : null;

    const nowMs = Date.now();
    const rows: BasesRankingRow[] = [];

    for (const [hash, baseEntry] of Object.entries(baseData)) {
      if (!baseEntry || baseEntry.bases === 0) continue;
      const company = knownCompanies[hash];
      if (!company) continue;

      const username = company.Username;
      const fio = fioMap.get(username.toLowerCase());
      const companyName = fio?.companyName ?? username;
      let daysActive: number | null = null;
      if (fio?.createdEpochMs != null) {
        const d = Math.floor((nowMs - fio.createdEpochMs) / (1000 * 60 * 60 * 24));
        if (d >= 0) daysActive = d;
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
      fioDataDate,
    } satisfies BasesRankingResponse);
  } catch (err) {
    console.error("bases-ranking error:", err);
    return NextResponse.json(
      { error: "Internal server error." } satisfies Partial<BasesRankingResponse>,
      { status: 500 }
    );
  }
}

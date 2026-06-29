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
  companyCode: string | null;
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

interface FioUserRecord {
  companyName: string;
  companyCode: string | null;
  createdEpochMs: number | null;
}

function parseCsvRows(csv: string): Map<string, FioUserRecord> {
  const map = new Map<string, FioUserRecord>();
  const lines = csv.split("\n");
  // CSV columns: username, company_name, company_code, created_epoch_ms
  // Any field may be quoted.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Minimal RFC 4180 parser for this fixed 4-column format
    const fields: string[] = [];
    let pos = 0;
    while (pos < line.length) {
      if (line[pos] === '"') {
        // quoted field
        let val = "";
        pos++; // skip opening quote
        while (pos < line.length) {
          if (line[pos] === '"' && line[pos + 1] === '"') { val += '"'; pos += 2; }
          else if (line[pos] === '"') { pos++; break; }
          else { val += line[pos++]; }
        }
        fields.push(val);
        if (line[pos] === ",") pos++;
      } else {
        const end = line.indexOf(",", pos);
        if (end === -1) { fields.push(line.slice(pos)); break; }
        fields.push(line.slice(pos, end));
        pos = end + 1;
      }
    }

    if (fields.length < 2) continue;
    const [username, companyName, companyCode, createdStr] = fields;
    const epochMs = createdStr ? parseInt(createdStr, 10) : NaN;
    map.set(username.toLowerCase(), {
      companyName: companyName || username,
      companyCode: companyCode || null,
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
      : new Map<string, FioUserRecord>();

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
      const companyCode = fio?.companyCode ?? null;
      let daysActive: number | null = null;
      if (fio?.createdEpochMs != null) {
        const d = Math.floor((nowMs - fio.createdEpochMs) / (1000 * 60 * 60 * 24));
        if (d >= 0) daysActive = d;
      }
      const daysPerBase = daysActive !== null ? daysActive / baseEntry.bases : null;

      // Exclude suspiciously fast builders: >5 bases with ≤0.5 days per base
      if (baseEntry.bases > 5 && daysPerBase !== null && daysPerBase <= 0.5) continue;

      rows.push({
        rank: 0,
        username,
        companyName,
        companyCode,
        corporation: company.Corporation ?? null,
        bases: baseEntry.bases,
        daysActive,
        daysPerBase,
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

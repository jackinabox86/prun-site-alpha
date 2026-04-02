import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GITHUB_RAW =
  "https://raw.githubusercontent.com/PMMG-Products/pmmg-products.github.io/main/reports/data";
const GITHUB_API =
  "https://api.github.com/repos/PMMG-Products/pmmg-products.github.io/contents/reports/data";

const MONTH_ABBRS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function yearMonthToCode(ym: string): string {
  const [year, month] = ym.split("-");
  const idx = parseInt(month, 10) - 1;
  return `${MONTH_ABBRS[idx]}${year.slice(2)}`;
}

function codeToYearMonth(code: string): string {
  const abbr = code.slice(0, 3);
  const yy = code.slice(3);
  const idx = MONTH_ABBRS.indexOf(abbr);
  const mm = String(idx + 1).padStart(2, "0");
  return `20${yy}-${mm}`;
}

interface KnownCompaniesData {
  [hash: string]: { Username: string; Corporation?: string };
}

interface CompanyDataFile {
  totals: {
    [hash: string]: {
      volume: number;
      profit: number;
      volumeRank: number;
      profitRank: number;
    };
  };
}

interface BaseDataFile {
  [hash: string]: { bases: number; rank: number };
}

interface GitHubFileEntry {
  name: string;
  type: string;
}

export interface PMMGRow {
  username: string;
  corporation: string | null;
  bases: number;
  profit: number;
  volume: number;
  profitPerBase: number;
  volumePerBase: number;
}

export interface PMMGApiResponse {
  rows: PMMGRow[];
  month: string;
  availableMonths: string[];
  error?: string;
}

async function fetchAvailableMonths(): Promise<string[]> {
  const res = await fetch(GITHUB_API, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const entries: GitHubFileEntry[] = await res.json();
  const months: string[] = [];
  for (const entry of entries) {
    const match = entry.name.match(/^company-data-([a-z]+\d{2})\.json$/);
    if (match) months.push(match[1]);
  }
  months.sort((a, b) => codeToYearMonth(b).localeCompare(codeToYearMonth(a)));
  return months;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get("month");

    const availableMonths = await fetchAvailableMonths();
    if (availableMonths.length === 0) {
      return NextResponse.json(
        { error: "Could not retrieve available months from GitHub." } satisfies Partial<PMMGApiResponse>,
        { status: 502 }
      );
    }

    let monthCode: string;
    if (!monthParam) {
      monthCode = availableMonths[0];
    } else if (/^\d{4}-\d{2}$/.test(monthParam)) {
      monthCode = yearMonthToCode(monthParam);
    } else {
      monthCode = monthParam;
    }

    if (!availableMonths.includes(monthCode)) {
      return NextResponse.json(
        { error: `Month "${monthCode}" is not available.` } satisfies Partial<PMMGApiResponse>,
        { status: 404 }
      );
    }

    const [companiesRes, companyDataRes, baseDataRes] = await Promise.all([
      fetch(`${GITHUB_RAW}/knownCompanies.json`, { cache: "no-store" }),
      fetch(`${GITHUB_RAW}/company-data-${monthCode}.json`, { cache: "no-store" }),
      fetch(`${GITHUB_RAW}/base-data-${monthCode}.json`, { cache: "no-store" }),
    ]);

    if (!companiesRes.ok || !companyDataRes.ok || !baseDataRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch one or more data files from GitHub." } satisfies Partial<PMMGApiResponse>,
        { status: 502 }
      );
    }

    const [knownCompanies, companyDataFile, baseDataFile]: [
      KnownCompaniesData,
      CompanyDataFile,
      BaseDataFile,
    ] = await Promise.all([
      companiesRes.json(),
      companyDataRes.json(),
      baseDataRes.json(),
    ]);

    const rows: PMMGRow[] = [];
    for (const [hash, compData] of Object.entries(companyDataFile.totals)) {
      if (compData.volumeRank > 100) continue;
      const companyInfo = knownCompanies[hash];
      const baseInfo = baseDataFile[hash];
      if (!companyInfo || !baseInfo || baseInfo.bases === 0) continue;

      rows.push({
        username: companyInfo.Username,
        corporation: companyInfo.Corporation ?? null,
        bases: baseInfo.bases,
        profit: compData.profit,
        volume: compData.volume,
        profitPerBase: compData.profit / baseInfo.bases,
        volumePerBase: compData.volume / baseInfo.bases,
      });
    }

    rows.sort((a, b) => b.profitPerBase - a.profitPerBase);

    return NextResponse.json({
      rows,
      month: monthCode,
      availableMonths,
    } satisfies PMMGApiResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

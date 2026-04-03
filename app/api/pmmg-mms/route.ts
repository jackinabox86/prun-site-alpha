import { NextResponse } from "next/server";

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
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const NEW_MMS = new Set(["AIR", "CCD", "LOG"]);
const OLD_MMS = new Set(["IDC", "EDC"]);

function codeToYearMonth(code: string): string {
  const abbr = code.slice(0, 3);
  const yy = code.slice(3);
  const idx = MONTH_ABBRS.indexOf(abbr);
  const mm = String(idx + 1).padStart(2, "0");
  return `20${yy}-${mm}`;
}

function formatMonthLabel(code: string): string {
  const abbr = code.slice(0, 3);
  const yy = code.slice(3);
  const idx = MONTH_ABBRS.indexOf(abbr);
  return idx >= 0 ? `${MONTH_NAMES[idx]} 20${yy}` : code;
}

interface GitHubFileEntry {
  name: string;
  type: string;
}

interface ProdDataFile {
  [ticker: string]: {
    amount: number;
    volume: number;
    profit: number;
    consumed?: number;
  };
}

export interface MMSPoint {
  monthCode: string;
  monthLabel: string;
  newMMPct: number;
  oldMMPct: number;
  otherPct: number;
  newMMVol: number;
  oldMMVol: number;
  otherVol: number;
}

export interface MMSApiResponse {
  data: MMSPoint[];
  error?: string;
}

export async function GET() {
  try {
    const dirRes = await fetch(GITHUB_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!dirRes.ok) {
      return NextResponse.json(
        { error: "Could not retrieve file listing from GitHub." } satisfies Partial<MMSApiResponse>,
        { status: 502 }
      );
    }

    const entries: GitHubFileEntry[] = await dirRes.json();
    const monthCodes: string[] = [];
    for (const entry of entries) {
      const match = entry.name.match(/^prod-data-([a-z]+\d{2})\.json$/);
      if (match) monthCodes.push(match[1]);
    }

    monthCodes.sort((a, b) => codeToYearMonth(a).localeCompare(codeToYearMonth(b)));

    if (monthCodes.length === 0) {
      return NextResponse.json(
        { error: "No prod-data files found." } satisfies Partial<MMSApiResponse>,
        { status: 404 }
      );
    }

    const fetches = await Promise.all(
      monthCodes.map((code) =>
        fetch(`${GITHUB_RAW}/prod-data-${code}.json`, { cache: "no-store" })
      )
    );

    const data: MMSPoint[] = await Promise.all(
      fetches.map(async (res, i) => {
        const code = monthCodes[i];
        const label = formatMonthLabel(code);
        if (!res.ok) {
          return { monthCode: code, monthLabel: label, newMMPct: 0, oldMMPct: 0, otherPct: 100, newMMVol: 0, oldMMVol: 0, otherVol: 0 };
        }

        const prodData: ProdDataFile = await res.json();
        let newMMVol = 0;
        let oldMMVol = 0;
        let otherVol = 0;

        for (const [ticker, entry] of Object.entries(prodData)) {
          const { volume = 0, amount = 0, consumed = 0, profit = 0 } = entry;
          if (NEW_MMS.has(ticker) || OLD_MMS.has(ticker)) {
            const val = volume - (amount !== 0 ? (volume / amount) * consumed : 0);
            if (NEW_MMS.has(ticker)) newMMVol += val;
            else oldMMVol += val;
          } else {
            otherVol += profit;
          }
        }

        const total = newMMVol + oldMMVol + otherVol;
        if (total === 0) {
          return { monthCode: code, monthLabel: label, newMMPct: 0, oldMMPct: 0, otherPct: 0, newMMVol: 0, oldMMVol: 0, otherVol: 0 };
        }

        return {
          monthCode: code,
          monthLabel: label,
          newMMPct: (newMMVol / total) * 100,
          oldMMPct: (oldMMVol / total) * 100,
          otherPct: (otherVol / total) * 100,
          newMMVol,
          oldMMVol,
          otherVol,
        };
      })
    );

    return NextResponse.json({ data } satisfies MMSApiResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

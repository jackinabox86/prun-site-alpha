import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const FIO_BASE = "https://rest.fnar.net";

const ALLOWED_TICKERS = new Set([
  "AAF", "AML", "APF", "ASM", "BMP", "CHP", "CLF", "CLR", "COL", "DRS",
  "ECA", "EDM", "EEP", "ELP", "EXT", "FER", "FP", "FRM", "FS", "GF",
  "HWP", "HYF", "INC", "IVP", "LAB", "MCA", "ORC", "PAC", "PHF", "POL",
  "PP1", "PP2", "PP3", "PP4", "PPF", "REF", "RIG", "SCA", "SD", "SE",
  "SKF", "SL", "SME", "SPF", "SPP", "TNP", "UPF", "WEL", "WPL",
]);

interface BuildingEntry {
  NaturalId: string;
  Ticker: string;
  Condition: number;
}

interface PlanetEntry {
  NaturalId: string;
  PlanetName: string;
}

export interface PlanetRepairInfo {
  planetId: string;
  planetName: string;
  minCondition: number;
  daysSinceRepair: number;
}

function daysSinceLastRepair(condition: number): number {
  const K = 1789 / 25000;
  const FLOOR = 0.33;
  const RANGE = 0.67;
  const INFLECTION = 100.87;
  const numerator = RANGE / (condition - FLOOR) - 1;
  return (1 / K) * Math.log(numerator) + INFLECTION;
}

export async function GET(request: Request) {
  const username = request.headers.get("x-fio-username");
  const apiKey = request.headers.get("x-fio-api-key");

  if (!username || !apiKey) {
    return NextResponse.json(
      { error: "FIO username and API key are required." },
      { status: 400 }
    );
  }

  try {
    const [buildingsRes, planetsRes] = await Promise.all([
      fetch(`${FIO_BASE}/rain/userplanetbuildings/${encodeURIComponent(username)}`, {
        headers: { accept: "application/json", Authorization: apiKey },
      }),
      fetch(`${FIO_BASE}/planet/allplanets`, {
        headers: { accept: "application/json" },
      }),
    ]);

    if (!buildingsRes.ok) {
      return NextResponse.json(
        { error: `FIO API error: ${buildingsRes.status} ${buildingsRes.statusText}` },
        { status: 502 }
      );
    }

    const buildings: BuildingEntry[] = await buildingsRes.json();

    const planetNameMap = new Map<string, string>();
    if (planetsRes.ok) {
      const allPlanets: PlanetEntry[] = await planetsRes.json();
      for (const p of allPlanets) {
        planetNameMap.set(p.NaturalId, p.PlanetName);
      }
    }

    // Group by planet, track minimum condition per planet
    const planetMinCondition = new Map<string, number>();
    for (const b of buildings) {
      if (!ALLOWED_TICKERS.has(b.Ticker)) continue;
      const current = planetMinCondition.get(b.NaturalId);
      if (current === undefined || b.Condition < current) {
        planetMinCondition.set(b.NaturalId, b.Condition);
      }
    }

    const results: PlanetRepairInfo[] = [];
    for (const [planetId, minCondition] of planetMinCondition.entries()) {
      // Guard against condition at or below FLOOR (formula blows up)
      if (minCondition <= 0.33) continue;
      results.push({
        planetId,
        planetName: planetNameMap.get(planetId) ?? planetId,
        minCondition,
        daysSinceRepair: daysSinceLastRepair(minCondition),
      });
    }

    results.sort((a, b) => b.daysSinceRepair - a.daysSinceRepair);

    return NextResponse.json({ planets: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

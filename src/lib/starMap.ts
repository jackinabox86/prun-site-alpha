// Star map data: loading and normalising the PrUn star-system export.
//
// The source is the raw FIO/PrUn systems response (an array of systems with
// PositionX/Y/Z). It is fetched from a URL so the file can move from
// `public/data` to external hosting (e.g. a public GCS object) by setting
// NEXT_PUBLIC_STAR_MAP_DATA_URL, without code changes. A cross-origin host
// must allow CORS GET from the site origin.

export const DEFAULT_STAR_MAP_DATA_URL = "/data/star-systems.json";

export function starMapDataUrl(): string {
  return process.env.NEXT_PUBLIC_STAR_MAP_DATA_URL || DEFAULT_STAR_MAP_DATA_URL;
}

/** Shape of one entry in the raw systems response (fields we read). */
interface RawStarSystem {
  SystemId?: string;
  Name?: string;
  NaturalId?: string;
  Type?: string;
  PositionX?: number;
  PositionY?: number;
  PositionZ?: number;
}

export interface Exchange {
  code: string;
  name: string;
  naturalId: string;
  color: string;
}

// The four commodity exchange systems, matched by NaturalId because names are
// not unique enough ("New Benten", "Antares II", ...).
export const EXCHANGES: Exchange[] = [
  { code: "AI1", name: "Antares I", naturalId: "ZV-307", color: "#ff5a4f" },
  { code: "CI1", name: "Benten", naturalId: "UV-351", color: "#3ea8ff" },
  { code: "NC1", name: "Moria", naturalId: "OT-580", color: "#c27bff" },
  { code: "IC1", name: "Hortus", naturalId: "VH-331", color: "#3dff8e" },
];

export interface StarSystem {
  id: string;
  name: string;
  naturalId: string;
  /** Spectral type letter (O, B, A, F, G, K, M). */
  type: string;
  x: number;
  y: number;
  z: number;
  exchange: Exchange | null;
}

export function parseStarSystems(raw: unknown): StarSystem[] {
  if (!Array.isArray(raw)) {
    throw new Error("Star data must be a JSON array of systems");
  }
  const exchangeById = new Map(EXCHANGES.map((e) => [e.naturalId, e]));
  const systems: StarSystem[] = [];
  for (const entry of raw as RawStarSystem[]) {
    const { PositionX: x, PositionY: y, PositionZ: z } = entry ?? {};
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const naturalId = entry.NaturalId ?? "";
    systems.push({
      id: entry.SystemId ?? naturalId,
      name: entry.Name || naturalId || "Unknown system",
      naturalId,
      type: entry.Type ?? "",
      x: x as number,
      y: y as number,
      z: z as number,
      exchange: exchangeById.get(naturalId) ?? null,
    });
  }
  return systems;
}

export async function loadStarSystems(url: string = starMapDataUrl()): Promise<StarSystem[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load star data from ${url}: HTTP ${res.status}`);
  }
  return parseStarSystems(await res.json());
}

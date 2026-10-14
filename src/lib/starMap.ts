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

// Planet names, in the FIO /planet/allplanets shape. The committed file holds
// only the planets with a real name; every other planet is addressed by its
// natural ID, which already names its system ("UV-351a" is in "UV-351"). The
// full allplanets response works here too.
export const DEFAULT_PLANET_DATA_URL = "/data/planet-names.json";

export function planetDataUrl(): string {
  return process.env.NEXT_PUBLIC_PLANET_DATA_URL || DEFAULT_PLANET_DATA_URL;
}

// Gateways, in the FIO api.fnar.net/gateway shape. The live endpoint allows
// cross-origin reads, so the map asks it first and falls back to the committed
// snapshot when it cannot be reached.
export const LIVE_GATEWAY_DATA_URL = "https://api.fnar.net/gateway?include_upkeeps=false&include_phases=false&include_contractors=false";
export const DEFAULT_GATEWAY_DATA_URL = "/data/gateways.json";

export function gatewayDataUrl(): string {
  return process.env.NEXT_PUBLIC_GATEWAY_DATA_URL || DEFAULT_GATEWAY_DATA_URL;
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
  Connections?: { ConnectingId?: string }[];
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
  /** Indices of the systems one jump away. */
  neighbors: number[];
}

export function parseStarSystems(raw: unknown): StarSystem[] {
  if (!Array.isArray(raw)) {
    throw new Error("Star data must be a JSON array of systems");
  }
  const exchangeById = new Map(EXCHANGES.map((e) => [e.naturalId, e]));
  const systems: StarSystem[] = [];
  const connectionIds: string[][] = [];
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
      neighbors: [],
    });
    connectionIds.push((entry.Connections ?? []).map((c) => c?.ConnectingId ?? ""));
  }
  const indexById = new Map(systems.map((s, i) => [s.id, i]));
  systems.forEach((s, i) => {
    for (const id of connectionIds[i]) {
      const j = indexById.get(id);
      if (j !== undefined && j !== i && !s.neighbors.includes(j)) s.neighbors.push(j);
    }
  });
  return systems;
}

export async function loadStarSystems(url: string = starMapDataUrl()): Promise<StarSystem[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load star data from ${url}: HTTP ${res.status}`);
  }
  return parseStarSystems(await res.json());
}

/** Planet natural ID -> name, from the FIO allplanets shape. */
export function parsePlanetNames(raw: unknown): Map<string, string> {
  const names = new Map<string, string>();
  if (!Array.isArray(raw)) return names;
  for (const p of raw as { PlanetNaturalId?: string; PlanetName?: string }[]) {
    if (p?.PlanetNaturalId && p.PlanetName && p.PlanetName !== p.PlanetNaturalId) {
      names.set(p.PlanetNaturalId, p.PlanetName);
    }
  }
  return names;
}

/** Planet names are optional: the map still works by natural ID without them. */
export async function loadPlanetNames(url: string = planetDataUrl()): Promise<Map<string, string>> {
  try {
    const res = await fetch(url);
    return res.ok ? parsePlanetNames(await res.json()) : new Map();
  } catch {
    return new Map();
  }
}

/** A working two-way gateway pair: one jump between two distant systems. */
export interface GatewayLink {
  a: number;
  b: number;
  name: string;
  /** The smaller of the two gates' ship volume limits, in m³. */
  maxShipVolume: number;
}

interface RawGateway {
  GatewayId?: string;
  Name?: string;
  LocationNaturalId?: string;
  OperationalState?: string;
  LinkStatus?: string;
  OutgoingLink?: string | null;
  MaxShipVolume?: number;
}

/**
 * Keeps only gateway pairs that can be used right now: both gates operational,
 * their link established, and each gate pointing at the other.
 */
export function parseGateways(raw: unknown, systems: StarSystem[]): GatewayLink[] {
  if (!Array.isArray(raw)) return [];
  const systemByNaturalId = new Map(systems.map((s, i) => [s.naturalId.toUpperCase(), i]));
  const systemOf = (planet?: string) => {
    const m = /^([A-Z]{2}-\d{3})/i.exec(planet ?? "");
    return m ? systemByNaturalId.get(m[1].toUpperCase()) : undefined;
  };
  const usable = (g?: RawGateway): g is RawGateway => g?.OperationalState === "OPERATIONAL" && g.LinkStatus === "ESTABLISHED";
  const byId = new Map((raw as RawGateway[]).filter((g) => g?.GatewayId).map((g) => [g.GatewayId!, g]));
  const links: GatewayLink[] = [];
  const seen = new Set<string>();
  for (const g of byId.values()) {
    const other = g.OutgoingLink ? byId.get(g.OutgoingLink) : undefined;
    if (!usable(g) || !usable(other) || other.OutgoingLink !== g.GatewayId) continue;
    const key = [g.GatewayId, other.GatewayId].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const a = systemOf(g.LocationNaturalId);
    const b = systemOf(other.LocationNaturalId);
    if (a === undefined || b === undefined || a === b) continue;
    links.push({
      a,
      b,
      name: g.Name || `${g.LocationNaturalId} - ${other.LocationNaturalId}`,
      maxShipVolume: Math.min(g.MaxShipVolume ?? 0, other.MaxShipVolume ?? 0),
    });
  }
  return links;
}

export interface GatewayData {
  links: GatewayLink[];
  source: "live" | "snapshot" | "none";
}

/** Gateways are optional: without them the map routes on jump lines only. */
export async function loadGateways(systems: StarSystem[]): Promise<GatewayData> {
  for (const [url, source] of [
    [LIVE_GATEWAY_DATA_URL, "live"],
    [gatewayDataUrl(), "snapshot"],
  ] as const) {
    try {
      const res = await fetch(url);
      if (res.ok) return { links: parseGateways(await res.json(), systems), source };
    } catch {
      // Try the next source.
    }
  }
  return { links: [], source: "none" };
}

const PLANET_ID = /^([A-Z]{2}-\d{3})([a-z])$/i;
const NAMED_SYSTEM_PLANET = /^(.+?)\s+([a-z])$/i;

export interface Lookup {
  /** Index of the system the query names. */
  system: number;
  /** Canonical label: the planet's natural ID, or the system name. */
  label: string;
  isPlanet: boolean;
}

export type Resolver = (query: string) => Lookup | null;

/**
 * Builds a case-insensitive resolver for planet names, planet natural IDs,
 * system names and system natural IDs.
 */
export function makeResolver(systems: StarSystem[], planetNames: Map<string, string>): Resolver {
  const systemByNaturalId = new Map<string, number>();
  const byKey = new Map<string, Lookup>();
  systems.forEach((s, i) => {
    byKey.set(s.name.toLowerCase(), { system: i, label: s.name, isPlanet: false });
    if (s.naturalId) {
      systemByNaturalId.set(s.naturalId.toUpperCase(), i);
      byKey.set(s.naturalId.toLowerCase(), { system: i, label: s.name, isPlanet: false });
    }
  });
  const planetLookup = (planetId: string): Lookup | null => {
    const m = PLANET_ID.exec(planetId);
    if (!m) return null;
    const system = systemByNaturalId.get(m[1].toUpperCase());
    if (system === undefined) return null;
    return { system, label: m[1].toUpperCase() + m[2].toLowerCase(), isPlanet: true };
  };
  // Planet names win over system names; the current data has no overlap.
  for (const [id, name] of planetNames) {
    const hit = planetLookup(id);
    if (hit) byKey.set(name.toLowerCase(), hit);
  }
  // Planets in named systems display as "<System> <letter>", e.g. "Metis b".
  const namedSystemPlanet = (q: string): Lookup | null => {
    const m = NAMED_SYSTEM_PLANET.exec(q);
    const hit = m && byKey.get(m[1].toLowerCase());
    if (!m || !hit || hit.isPlanet) return null;
    return { system: hit.system, label: `${hit.label} ${m[2].toLowerCase()}`, isPlanet: true };
  };
  return (query) => {
    const q = query.trim();
    if (!q) return null;
    return byKey.get(q.toLowerCase()) ?? planetLookup(q) ?? namedSystemPlanet(q);
  };
}

/** Splits a pasted base list on newlines, commas and semicolons. */
export function splitList(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Breadth-first jump distances and predecessors from one system. */
function jumpsFrom(systems: StarSystem[], start: number, gates: Map<number, number[]>) {
  const dist = new Array<number>(systems.length).fill(-1);
  const prev = new Array<number>(systems.length).fill(-1);
  dist[start] = 0;
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const j of [...systems[i].neighbors, ...(gates.get(i) ?? [])]) {
      if (dist[j] !== -1) continue;
      dist[j] = dist[i] + 1;
      prev[j] = i;
      queue.push(j);
    }
  }
  return { dist, prev };
}

export interface EmpireRoute {
  base: number;
  exchange: number;
  jumps: number;
  /** System indices from the base to the exchange, inclusive. */
  path: number[];
  /** Smallest ship volume limit of the gateways on the path; null when it uses none. */
  gatewayLimit: number | null;
}

export interface Empire {
  routes: EmpireRoute[];
  /** Every system shown in empire view. */
  systems: Set<number>;
  /** Jump edges on the routes, as system index pairs. */
  edges: [number, number][];
  /** The edges that are gateway jumps. */
  gatewayEdges: [number, number][];
}

/** Matches an exchange by code, name or system natural ID ("AI1", "Antares", "ZV-307"). */
export function findExchange(text: string): Exchange | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  return (
    EXCHANGES.find((x) => x.code.toLowerCase() === t || x.naturalId.toLowerCase() === t || x.name.toLowerCase() === t) ??
    EXCHANGES.find((x) => x.name.toLowerCase().startsWith(t)) ??
    null
  );
}

/**
 * For each base system: the exchange with the fewest jumps (ties broken by
 * straight-line distance) and the shortest jump route to it. A gateway counts
 * as one jump. `exchangeFor` pins a base system to one exchange instead.
 */
export function computeEmpire(
  systems: StarSystem[],
  baseSystems: number[],
  exchangeFor?: (base: number) => Exchange | null,
  gateways: GatewayLink[] = [],
): Empire {
  const pairKey = (i: number, j: number) => (i < j ? `${i}-${j}` : `${j}-${i}`);
  const gates = new Map<number, number[]>();
  const gateLimit = new Map<string, number>();
  for (const g of gateways) {
    gates.set(g.a, [...(gates.get(g.a) ?? []), g.b]);
    gates.set(g.b, [...(gates.get(g.b) ?? []), g.a]);
    const key = pairKey(g.a, g.b);
    gateLimit.set(key, Math.max(gateLimit.get(key) ?? 0, g.maxShipVolume));
  }
  const exchanges = systems.flatMap((s, i) => (s.exchange ? [i] : []));
  const fromExchange = new Map(exchanges.map((x) => [x, jumpsFrom(systems, x, gates)]));
  const routes: EmpireRoute[] = [];
  const shown = new Set<number>();
  const edgeKeys = new Set<string>();
  const edges: [number, number][] = [];
  const gatewayEdges: [number, number][] = [];
  for (const base of new Set(baseSystems)) {
    shown.add(base);
    let best: { x: number; jumps: number; d2: number } | null = null;
    const pinned = exchangeFor?.(base);
    for (const x of exchanges) {
      if (pinned && systems[x].exchange !== pinned) continue;
      const jumps = fromExchange.get(x)!.dist[base];
      if (jumps < 0) continue;
      const a = systems[base];
      const b = systems[x];
      const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
      if (!best || jumps < best.jumps || (jumps === best.jumps && d2 < best.d2)) best = { x, jumps, d2 };
    }
    if (!best) continue;
    // Following predecessors from the base walks back to the exchange.
    const { prev } = fromExchange.get(best.x)!;
    const path = [base];
    let gatewayLimit: number | null = null;
    for (let i = base; i !== best.x; i = prev[i]) {
      const next = prev[i];
      const key = pairKey(i, next);
      // A gateway pair whose systems are also one jump line apart is still
      // reached by the jump line, which has no size limit.
      const viaGate = gateLimit.has(key) && !systems[i].neighbors.includes(next);
      if (viaGate) gatewayLimit = Math.min(gatewayLimit ?? Infinity, gateLimit.get(key)!);
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        (viaGate ? gatewayEdges : edges).push([i, next]);
      }
      path.push(next);
    }
    path.forEach((i) => shown.add(i));
    routes.push({ base, exchange: best.x, jumps: best.jumps, path, gatewayLimit });
  }
  return { routes, systems: shown, edges, gatewayEdges };
}

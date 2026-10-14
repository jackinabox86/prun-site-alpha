// Shipping route recommendations from a pasted RPrUn burn table.
//
// The burn table (XIT BURN, copied as TSV) gives each base's net daily rate per
// material: negative is consumed, positive is produced. Material weight and
// volume come from FIO /material/allmaterials. A route is a milk run from an
// exchange: it leaves with every stop's inputs and picks up outputs as it goes,
// the same load model refined-prun's ROUTEBURN uses. There are no flight times
// here, so jumps stand in for lap length.

import type { Empire, Resolver, StarSystem } from "./starMap";

export const DEFAULT_MATERIAL_DATA_URL = "/data/material-sizes.json";

export function materialDataUrl(): string {
  return process.env.NEXT_PUBLIC_MATERIAL_DATA_URL || DEFAULT_MATERIAL_DATA_URL;
}

export interface MaterialSize {
  weight: number;
  volume: number;
}

/** Ticker -> size per unit, from the FIO allmaterials shape. */
export function parseMaterialSizes(raw: unknown): Map<string, MaterialSize> {
  const sizes = new Map<string, MaterialSize>();
  if (!Array.isArray(raw)) return sizes;
  for (const m of raw as { Ticker?: string; Weight?: number; Volume?: number }[]) {
    if (m?.Ticker && Number.isFinite(m.Weight) && Number.isFinite(m.Volume)) {
      sizes.set(m.Ticker.toUpperCase(), { weight: m.Weight as number, volume: m.Volume as number });
    }
  }
  return sizes;
}

export async function loadMaterialSizes(url: string = materialDataUrl()): Promise<Map<string, MaterialSize>> {
  try {
    const res = await fetch(url);
    return res.ok ? parseMaterialSizes(await res.json()) : new Map();
  } catch {
    return new Map();
  }
}

/** Ship hold sizes, matching refined-prun's ship-sizes.ts. */
export const SHIP_SIZES = [
  { id: "500/500", label: "500t / 500m³", weight: 500, volume: 500 },
  { id: "1k/3k", label: "1kt / 3km³", weight: 1000, volume: 3000 },
  { id: "2k/2k", label: "2kt / 2km³", weight: 2000, volume: 2000 },
  { id: "3k/1k", label: "3kt / 1km³", weight: 3000, volume: 1000 },
  { id: "5k/5k", label: "5kt / 5km³", weight: 5000, volume: 5000 },
] as const;

export type ShipSize = (typeof SHIP_SIZES)[number];

/** Daily cargo per day: what has to arrive (in) and what is there to collect (out). */
export interface DailyLoad {
  inT: number;
  inV: number;
  outT: number;
  outV: number;
}

const emptyLoad = (): DailyLoad => ({ inT: 0, inV: 0, outT: 0, outV: 0 });

function addLoad(a: DailyLoad, b: DailyLoad) {
  a.inT += b.inT;
  a.inV += b.inV;
  a.outT += b.outT;
  a.outV += b.outV;
}

export interface BurnBase {
  planet: string;
  load: DailyLoad;
}

export interface ParsedBurn {
  bases: BurnBase[];
  /** Tickers with no known size; they are left out of the loads. */
  unknownTickers: string[];
}

/**
 * Parses the RPrUn burn table (Planet, Ticker, Inv, Burn/day, ...). The header
 * row and the "Overall" block are skipped: Overall nets one base's output
 * against another base's use, which only holds if the goods are moved.
 */
export function parseBurn(text: string, sizes: Map<string, MaterialSize>): ParsedBurn {
  const byPlanet = new Map<string, DailyLoad>();
  const unknown = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split("\t");
    if (cols.length < 4) continue;
    const planet = cols[0].trim();
    const ticker = cols[1].trim().toUpperCase();
    const rate = parseFloat(cols[3]);
    if (!planet || planet === "Overall" || !ticker || !Number.isFinite(rate)) continue;
    const load = byPlanet.get(planet) ?? emptyLoad();
    byPlanet.set(planet, load);
    if (rate === 0) continue;
    const size = sizes.get(ticker);
    if (!size) {
      unknown.add(ticker);
      continue;
    }
    if (rate < 0) {
      load.inT += -rate * size.weight;
      load.inV += -rate * size.volume;
    } else {
      load.outT += rate * size.weight;
      load.outV += rate * size.volume;
    }
  }
  return {
    bases: [...byPlanet].map(([planet, load]) => ({ planet, load })),
    unknownTickers: [...unknown].sort(),
  };
}

/** A base's daily load, resolved to its star system. */
export interface SystemLoad {
  system: number;
  planets: string[];
  load: DailyLoad;
}

export function loadsBySystem(bases: BurnBase[], resolve: Resolver): { loads: Map<number, SystemLoad>; unresolved: string[] } {
  const loads = new Map<number, SystemLoad>();
  const unresolved: string[] = [];
  for (const base of bases) {
    const hit = resolve(base.planet);
    if (!hit) {
      unresolved.push(base.planet);
      continue;
    }
    const entry = loads.get(hit.system) ?? { system: hit.system, planets: [], load: emptyLoad() };
    loads.set(hit.system, entry);
    entry.planets.push(base.planet);
    addLoad(entry.load, base.load);
  }
  return { loads, unresolved };
}

export interface PlannedRoute {
  exchange: number;
  /** Stops in visiting order, nearest the exchange first. */
  stops: SystemLoad[];
  /** Daily totals over all stops. */
  load: DailyLoad;
  /** Days of supply one hold carries, at the milk-run peak. */
  coverDays: number;
  binding: "weight" | "volume";
  /** Rough jumps per lap: out to the farthest stop and back, plus side trips. */
  lapJumps: number;
  /** A single stop the ship cannot carry the minimum days for. */
  overloaded: boolean;
  /** Systems on the lap, for highlighting. */
  systems: number[];
  edges: [number, number][];
}

/**
 * Days of supply a hold carries for these stops in this order. The ship leaves
 * with every stop's inputs, drops each stop's inputs and picks up its outputs,
 * and the fullest moment anywhere on the lap sets the limit.
 */
export function coverDays(stops: SystemLoad[], ship: { weight: number; volume: number }) {
  let inT = 0;
  let inV = 0;
  for (const s of stops) {
    inT += s.load.inT;
    inV += s.load.inV;
  }
  let peakT = inT;
  let peakV = inV;
  let t = inT;
  let v = inV;
  for (const s of stops) {
    t += s.load.outT - s.load.inT;
    v += s.load.outV - s.load.inV;
    peakT = Math.max(peakT, t);
    peakV = Math.max(peakV, v);
  }
  const byWeight = peakT > 0 ? ship.weight / peakT : Infinity;
  const byVolume = peakV > 0 ? ship.volume / peakV : Infinity;
  return byWeight <= byVolume ? { days: byWeight, binding: "weight" as const } : { days: byVolume, binding: "volume" as const };
}

/** Stops more than this many jumps off a route's trunk start a separate route. */
export const MAX_DETOUR_JUMPS = 2;

function bfs(systems: StarSystem[], sources: Iterable<number>, limit: number) {
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const queue: number[] = [];
  for (const s of sources) {
    dist.set(s, 0);
    queue.push(s);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const d = dist.get(i)!;
    if (d >= limit) continue;
    for (const j of systems[i].neighbors) {
      if (dist.has(j)) continue;
      dist.set(j, d + 1);
      prev.set(j, i);
      queue.push(j);
    }
  }
  return { dist, prev };
}

/**
 * Groups base systems into milk-run routes for one ship size. Each route starts
 * at the farthest unplanned system of its exchange and takes in the nearest
 * systems on or beside its path while the hold still carries `minDays` of
 * supply. A system that alone needs more than the hold is its own route,
 * flagged as overloaded.
 */
export function planRoutes(
  systems: StarSystem[],
  empire: Empire,
  loads: Map<number, SystemLoad>,
  ship: { weight: number; volume: number },
  minDays: number,
): PlannedRoute[] {
  const routeOf = new Map(empire.routes.map((r) => [r.base, r]));
  const byExchange = new Map<number, number[]>();
  for (const system of loads.keys()) {
    const r = routeOf.get(system);
    if (!r) continue;
    const list = byExchange.get(r.exchange) ?? [];
    list.push(system);
    byExchange.set(r.exchange, list);
  }

  const planned: PlannedRoute[] = [];
  for (const [exchange, members] of byExchange) {
    const jumpsOf = (s: number) => routeOf.get(s)!.jumps;
    const open = new Set(members);
    const farthestFirst = [...members].sort((a, b) => jumpsOf(b) - jumpsOf(a) || loads.get(b)!.load.inT - loads.get(a)!.load.inT);
    for (const start of farthestFirst) {
      if (!open.has(start)) continue;
      open.delete(start);
      const chosen = [start];
      // The trunk is the start's path to the exchange. Other stops sit on it or
      // on a short side trip off it; measuring from the trunk alone keeps side
      // trips from chaining outward.
      const trunk = routeOf.get(start)!.path;
      const onLap = new Set(trunk);
      const { dist, prev } = bfs(systems, trunk, MAX_DETOUR_JUMPS);
      const sideEdges: [number, number][] = [];
      let detourJumps = 0;
      const order = (list: number[]) => [...list].sort((a, b) => jumpsOf(a) - jumpsOf(b)).map((s) => loads.get(s)!);
      const fit = (list: number[]) => coverDays(order(list), ship);
      const overloaded = fit(chosen).days < minDays;

      while (!overloaded) {
        const candidates = [...open]
          .filter((s) => dist.has(s))
          .sort((a, b) => dist.get(a)! - dist.get(b)! || loads.get(b)!.load.inT - loads.get(a)!.load.inT);
        const next = candidates.find((s) => fit([...chosen, s]).days >= minDays);
        if (next === undefined) break;
        open.delete(next);
        chosen.push(next);
        detourJumps += dist.get(next)!;
        for (let i = next; dist.get(i)! > 0; i = prev.get(i)!) {
          if (!onLap.has(i)) sideEdges.push([i, prev.get(i)!]);
          onLap.add(i);
        }
      }

      const stops = order(chosen);
      const load = emptyLoad();
      stops.forEach((s) => addLoad(load, s.load));
      const { days, binding } = fit(chosen);
      const edgeKeys = new Set<string>();
      const edges: [number, number][] = [];
      const addEdge = ([a, b]: [number, number]) => {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (edgeKeys.has(key)) return;
        edgeKeys.add(key);
        edges.push([a, b]);
      };
      // Stops on the start's path share its edges; the rest hang off side trips.
      for (let i = 0; i + 1 < trunk.length; i++) addEdge([trunk[i], trunk[i + 1]]);
      sideEdges.forEach(addEdge);
      planned.push({
        exchange,
        stops,
        load,
        coverDays: days,
        binding,
        lapJumps: 2 * Math.max(...chosen.map(jumpsOf)) + 2 * detourJumps,
        overloaded,
        systems: [...onLap],
        edges,
      });
    }
  }
  return planned.sort((a, b) => a.exchange - b.exchange || b.load.inT - a.load.inT);
}

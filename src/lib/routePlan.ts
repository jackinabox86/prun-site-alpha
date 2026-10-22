// Shipping route recommendations from a pasted RPrUn burn table.
//
// The burn table (XIT BURN, copied as TSV) gives each base's net daily rate per
// material: negative is consumed, positive is produced. Material weight and
// volume come from FIO /material/allmaterials. A route is a milk run from an
// exchange: it leaves with every stop's inputs and picks up outputs as it goes,
// the same load model refined-prun's ROUTEBURN uses. There are no flight times
// here, so jumps stand in for lap length; a gateway counts as one jump, and a
// ship may only take a gateway its volume fits.
//
// Milk runs: when one base on a lap makes what a later stop on the same lap
// uses, the ship can hand it over instead of selling it at the exchange and
// buying it back. That lightens the hold, so a ship may cover more bases.

import type { Empire, EmpireRoute, Resolver, StarSystem } from "./starMap";

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

/** One material's net daily rate at a base, with its size per unit. */
export interface Flow {
  ticker: string;
  /** Negative is consumed, positive is produced. */
  rate: number;
  weight: number;
  volume: number;
}

export interface BurnBase {
  planet: string;
  load: DailyLoad;
  flows: Flow[];
}

export interface ParsedBurn {
  bases: BurnBase[];
  /** Tickers with no known size; they are left out of the loads. */
  unknownTickers: string[];
}

/**
 * Parses the RPrUn burn table (Planet, Ticker, Inv, Burn/day, ...). With BURN's
 * In/Out view on, the columns are Inv, In, Out, Net, so the header row decides
 * which column holds the net rate; with no header it is Burn/day's column. The
 * "Overall" block is skipped: Overall nets one base's output against another
 * base's use, which only holds if the goods are moved.
 */
export function parseBurn(text: string, sizes: Map<string, MaterialSize>): ParsedBurn {
  const byPlanet = new Map<string, DailyLoad>();
  const flowsOf = new Map<string, Flow[]>();
  const unknown = new Set<string>();
  let rateCol = 3;
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split("\t").map((c) => c.trim());
    if (cols[1] === "Ticker") {
      const net = cols.indexOf("Net");
      rateCol = net >= 0 ? net : 3;
      continue;
    }
    if (cols.length <= rateCol) continue;
    const planet = cols[0];
    const ticker = cols[1].toUpperCase();
    const rate = parseFloat(cols[rateCol]);
    if (!planet || planet === "Overall" || !ticker || !Number.isFinite(rate)) continue;
    const load = byPlanet.get(planet) ?? emptyLoad();
    byPlanet.set(planet, load);
    const flows = flowsOf.get(planet) ?? [];
    flowsOf.set(planet, flows);
    if (rate === 0) continue;
    const size = sizes.get(ticker);
    if (!size) {
      unknown.add(ticker);
      continue;
    }
    flows.push({ ticker, rate, weight: size.weight, volume: size.volume });
    if (rate < 0) {
      load.inT += -rate * size.weight;
      load.inV += -rate * size.volume;
    } else {
      load.outT += rate * size.weight;
      load.outV += rate * size.volume;
    }
  }
  return {
    bases: [...byPlanet].map(([planet, load]) => ({ planet, load, flows: flowsOf.get(planet) ?? [] })),
    unknownTickers: [...unknown].sort(),
  };
}

/** One or more bases in one star system, with their combined daily load. */
export interface SystemLoad {
  system: number;
  planets: string[];
  load: DailyLoad;
  flows: Flow[];
}

/**
 * Resolves each base to its star system. Every base stays its own stop, so
 * bases that share a system can still go on different ships.
 */
export function loadsByBase(bases: BurnBase[], resolve: Resolver): { stops: SystemLoad[]; unresolved: string[] } {
  const stops: SystemLoad[] = [];
  const unresolved: string[] = [];
  for (const base of bases) {
    const hit = resolve(base.planet);
    if (hit) stops.push({ system: hit.system, planets: [base.planet], load: { ...base.load }, flows: base.flows });
    else unresolved.push(base.planet);
  }
  return { stops, unresolved };
}

export interface PlannedRoute {
  exchange: number;
  /** The hold this route is planned for; null when the fleet has no ship left for it. */
  ship: ShipSize | null;
  /** Stops in visiting order; bases in one system are merged. */
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
  /** Smallest gateway ship volume limit on the lap; null when it uses no gateway. */
  gatewayLimit: number | null;
  /** The ship is too big for a gateway on the lap. */
  gatewayBlocked: boolean;
  /** Systems on the lap, for highlighting. */
  systems: number[];
  edges: [number, number][];
  gatewayEdges: [number, number][];
  /** Materials handed from one base to a later stop on the lap (milk runs only). */
  transfers: Transfer[];
}

export interface Transfer {
  from: string;
  to: string;
  ticker: string;
  /** Units per day. */
  rate: number;
}

type Hold = { weight: number; volume: number };

/**
 * Days of supply a hold carries for these stops in this order. The ship leaves
 * with every stop's inputs, drops each stop's inputs and picks up its outputs,
 * and the fullest moment anywhere on the lap sets the limit.
 */
export function coverDays(stops: SystemLoad[], ship: Hold) {
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

/**
 * coverDays for a milk run: an output can feed any later stop on the lap, so
 * the ship leaves the exchange with only what earlier stops cannot supply.
 * Per material, what the ship must carry from the exchange is the largest
 * running shortfall; earlier output is handed on first in, first out.
 */
export function milkCoverDays(stops: SystemLoad[], ship: Hold) {
  const byTicker = new Map<string, { weight: number; volume: number; net: number[] }>();
  stops.forEach((s, k) => {
    for (const f of s.flows) {
      let m = byTicker.get(f.ticker);
      if (!m) {
        m = { weight: f.weight, volume: f.volume, net: new Array<number>(stops.length).fill(0) };
        byTicker.set(f.ticker, m);
      }
      m.net[k] += f.rate;
    }
  });
  // Hold contents on leaving the exchange (index 0) and after each stop.
  const t = new Array<number>(stops.length + 1).fill(0);
  const v = new Array<number>(stops.length + 1).fill(0);
  const transfers = new Map<string, Transfer>();
  for (const [ticker, m] of byTicker) {
    let running = 0;
    let shortfall = 0;
    for (const r of m.net) {
      running -= r;
      shortfall = Math.max(shortfall, running);
    }
    let load = shortfall;
    t[0] += load * m.weight;
    v[0] += load * m.volume;
    const supply: { stop: number; rate: number }[] = [];
    m.net.forEach((r, k) => {
      load += r;
      t[k + 1] += load * m.weight;
      v[k + 1] += load * m.volume;
      if (r > 0) supply.push({ stop: k, rate: r });
      let need = -r;
      while (need > 1e-9 && supply.length > 0) {
        const from = supply[0];
        const rate = Math.min(need, from.rate);
        const key = `${from.stop}|${k}|${ticker}`;
        const prior = transfers.get(key);
        if (prior) prior.rate += rate;
        else transfers.set(key, { from: stops[from.stop].planets.join(", "), to: stops[k].planets.join(", "), ticker, rate });
        need -= rate;
        from.rate -= rate;
        if (from.rate <= 1e-9) supply.shift();
      }
    });
  }
  const peakT = Math.max(...t);
  const peakV = Math.max(...v);
  const byWeight = peakT > 0 ? ship.weight / peakT : Infinity;
  const byVolume = peakV > 0 ? ship.volume / peakV : Infinity;
  return {
    days: Math.min(byWeight, byVolume),
    binding: byWeight <= byVolume ? ("weight" as const) : ("volume" as const),
    transfers: [...transfers.values()],
  };
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

/** Ship counts by SHIP_SIZES id. */
export type Fleet = Map<string, number>;

/** Parses the stored fleet text, "500/500:2,5k/5k:1". */
export function parseFleet(text: string): Fleet {
  const fleet: Fleet = new Map();
  for (const part of text.split(",")) {
    const [id, count] = part.split(":");
    const n = parseInt(count, 10);
    if (SHIP_SIZES.some((s) => s.id === id) && n > 0) fleet.set(id, n);
  }
  return fleet;
}

export function formatFleet(fleet: Fleet): string {
  return [...fleet].map(([id, n]) => `${id}:${n}`).join(",");
}

const capacity = (s: Hold) => s.weight + s.volume;

/** Joins consecutive stops in one system into a single stop, and totals the load. */
function mergeStops(ordered: SystemLoad[]) {
  const stops: SystemLoad[] = [];
  const load = emptyLoad();
  for (const s of ordered) {
    addLoad(load, s.load);
    const last = stops[stops.length - 1];
    if (last?.system === s.system) {
      last.planets.push(...s.planets);
      addLoad(last.load, s.load);
      last.flows.push(...s.flows);
    } else {
      stops.push({ system: s.system, planets: [...s.planets], load: { ...s.load }, flows: [...s.flows] });
    }
  }
  return { stops, load };
}

/**
 * Groups bases into milk-run routes. Each route starts at the farthest
 * unplanned base of its exchange and takes in the nearest bases on or beside
 * its path while the hold still carries `minDays` of supply. Bases in the
 * start's own system come first, but any of them can spill onto another route.
 *
 * `ships` is either one hold for every route, or a fleet. With a fleet, each
 * route tries every size still available, keeps the one that takes in the most
 * bases, and then moves down to the smallest size that still carries those
 * bases for `minDays`. Taking in the most bases per ship is what keeps the ship
 * count low. A base no available ship can carry for `minDays` gets the ship that
 * comes closest and is flagged overloaded. Once the fleet runs out, the rest
 * are listed as one route with no ship.
 *
 * Which base starts each route changes the result a lot, so a fleet is planned
 * with several start orders and the best plan wins: the fewest bases left
 * without a ship, then the fewest on overloaded routes, then the fewest ships.
 *
 * `empireFor` gives the paths a ship of a given volume can fly: gateways cap
 * ship volume, so a big ship may have to take the jump lines instead. Each
 * base keeps the exchange `empire` gave it.
 */
export function planRoutes(
  systems: StarSystem[],
  empire: Empire,
  allStops: SystemLoad[],
  ships: ShipSize | Fleet,
  minDays: number,
  empireFor: (shipVolume: number) => Empire = () => empire,
  milk = false,
): PlannedRoute[] {
  if (!(ships instanceof Map)) return planOnce(systems, empire, empireFor, allStops, ships, minDays, "farthest", milk);
  let best: PlannedRoute[] | null = null;
  let bestScore: number[] = [];
  for (const startOrder of START_ORDERS) {
    const plan = planOnce(systems, empire, empireFor, allStops, ships, minDays, startOrder, milk);
    const s = planScore(plan);
    if (!best || betterScore(s, bestScore)) {
      best = plan;
      bestScore = s;
    }
  }
  return best!;
}

/** Lower is better: bases with no ship, bases on short routes, ships, jumps. */
export function planScore(plan: PlannedRoute[]): number[] {
  const bases = (r: PlannedRoute) => r.stops.reduce((n, s) => n + s.planets.length, 0);
  let unserved = 0;
  let short = 0;
  let used = 0;
  let jumps = 0;
  for (const r of plan) {
    if (!r.ship) unserved += bases(r);
    else {
      used++;
      jumps += r.lapJumps;
      if (r.overloaded || r.gatewayBlocked) short += bases(r);
    }
  }
  return [unserved, short, used, jumps];
}

export function betterScore(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * farthest: the farthest open base starts the next route.
 * farthest-fit: the same, but bases no ship in the fleet can carry for minDays
 *   go last, so they never take a ship from a route that would work.
 * heaviest-fit: bases that need the biggest holds go first, so they get the big
 *   ships before lighter routes use them up; unservable bases still go last.
 */
const START_ORDERS = ["farthest", "farthest-fit", "heaviest-fit"] as const;

const edgeKey = ([a, b]: [number, number]) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** One empire's routes, indexed for planning. */
interface Paths {
  routeOf: Map<number, EmpireRoute>;
  gatewayKeys: Set<string>;
}

function indexPaths(empire: Empire): Paths {
  return { routeOf: new Map(empire.routes.map((r) => [r.base, r])), gatewayKeys: new Set(empire.gatewayEdges.map(edgeKey)) };
}

function planOnce(
  systems: StarSystem[],
  empire: Empire,
  empireFor: (shipVolume: number) => Empire,
  allStops: SystemLoad[],
  ships: ShipSize | Fleet,
  minDays: number,
  startOrder: (typeof START_ORDERS)[number],
  milk: boolean,
): PlannedRoute[] {
  // Without milk runs a lap visits the nearest stop first. A milk run also
  // tries the farthest stop first, so far outputs can feed nearer stops on
  // the way home, and keeps whichever order carries more days.
  const cover = (ordered: SystemLoad[], hold: Hold) => {
    if (!milk) return { ...coverDays(ordered, hold), ordered, transfers: [] as Transfer[] };
    const reversed = [...ordered].reverse();
    const out = milkCoverDays(ordered, hold);
    const back = milkCoverDays(reversed, hold);
    return back.days > out.days ? { ...back, ordered: reversed } : { ...out, ordered };
  };
  const left = ships instanceof Map ? new Map(ships) : null;
  const main = indexPaths(empire);
  const pathsByVolume = new Map<number, Paths>();
  const pathsFor = (hold: Hold) => {
    let paths = pathsByVolume.get(hold.volume);
    if (!paths) {
      paths = indexPaths(empireFor(hold.volume));
      pathsByVolume.set(hold.volume, paths);
    }
    return paths;
  };

  const byExchange = new Map<number, number[]>();
  allStops.forEach((stop, i) => {
    const r = main.routeOf.get(stop.system);
    if (!r) return;
    const list = byExchange.get(r.exchange) ?? [];
    list.push(i);
    byExchange.set(r.exchange, list);
  });

  const jumpsIn = (paths: Paths) => (i: number) => (paths.routeOf.get(allStops[i].system) ?? main.routeOf.get(allStops[i].system)!).jumps;
  const mainJumps = jumpsIn(main);
  const orderBy = (jumpsOf: (i: number) => number) => (list: number[]) =>
    [...list].sort((a, b) => jumpsOf(a) - jumpsOf(b) || allStops[a].system - allStops[b].system).map((i) => allStops[i]);
  const mainOrder = orderBy(mainJumps);

  const planned: PlannedRoute[] = [];
  for (const [exchange, members] of byExchange) {
    const open = new Set(members);
    const farthestFirst = [...members].sort((a, b) => mainJumps(b) - mainJumps(a) || allStops[b].load.inT - allStops[a].load.inT);
    const owned = SHIP_SIZES.filter((s) => (left?.get(s.id) ?? 0) > 0).sort((a, b) => capacity(a) - capacity(b));
    const neededHold = (i: number) => {
      const fit = owned.find((s) => coverDays([allStops[i]], s).days >= minDays);
      return fit ? capacity(fit) : -1;
    };
    const starts =
      startOrder === "heaviest-fit"
        ? [...farthestFirst].sort((a, b) => neededHold(b) - neededHold(a))
        : startOrder === "farthest-fit"
          ? [...farthestFirst].sort((a, b) => Number(neededHold(a) < 0) - Number(neededHold(b) < 0))
          : farthestFirst;
    for (const start of starts) {
      if (!open.has(start)) continue;
      if (left && SHIP_SIZES.every((s) => (left.get(s.id) ?? 0) <= 0)) {
        // The fleet is used up: everything still open is listed once, unserved.
        const { stops, load } = mergeStops(mainOrder([...open]));
        open.clear();
        planned.push({
          exchange,
          ship: null,
          stops,
          load,
          coverDays: 0,
          binding: "weight",
          lapJumps: 0,
          overloaded: true,
          gatewayLimit: null,
          gatewayBlocked: false,
          systems: stops.map((x) => x.system),
          edges: [],
          gatewayEdges: [],
          transfers: [],
        });
        break;
      }
      open.delete(start);

      // The trunk is the start's path to the exchange, as this hold can fly it.
      // Other stops sit on it or on a short side trip off it; measuring from the
      // trunk alone keeps side trips from chaining outward.
      const grow = (hold: Hold) => {
        const paths = pathsFor(hold);
        const routeOf = (i: number) => paths.routeOf.get(allStops[i].system) ?? main.routeOf.get(allStops[i].system)!;
        const order = orderBy(jumpsIn(paths));
        const trunk = routeOf(start).path;
        const { dist, prev } = bfs(systems, trunk, MAX_DETOUR_JUMPS);
        const distOf = (i: number) => dist.get(allStops[i].system);
        const candidates = [...open]
          .filter((i) => distOf(i) !== undefined)
          .sort((a, b) => distOf(a)! - distOf(b)! || allStops[b].load.inT - allStops[a].load.inT);
        const chosen = [start];
        const overloaded = cover(order(chosen), hold).days < minDays;
        if (!overloaded) {
          for (const c of candidates) {
            if (cover(order([...chosen, c]), hold).days >= minDays) chosen.push(c);
          }
        }
        return { chosen, overloaded, paths, routeOf, order, trunk, dist, prev };
      };
      type Lap = ReturnType<typeof grow>;

      let ship: ShipSize;
      let lap: Lap;
      if (!left) {
        ship = ships as ShipSize;
        lap = grow(ship);
      } else {
        const available = SHIP_SIZES.filter((s) => (left.get(s.id) ?? 0) > 0);
        const tries = available.map((s) => ({ ship: s, lap: grow(s) }));
        const fitting = tries.filter((t) => !t.lap.overloaded);
        if (fitting.length > 0) {
          const best = fitting.reduce((a, b) =>
            b.lap.chosen.length > a.lap.chosen.length || (b.lap.chosen.length === a.lap.chosen.length && capacity(b.ship) < capacity(a.ship)) ? b : a,
          );
          // The smallest free ship that still carries these bases; it keeps the
          // lap it grows itself, which holds the same bases or more.
          const smaller = [...available]
            .sort((a, b) => capacity(a) - capacity(b))
            .map((s) => tries.find((t) => t.ship === s)!)
            .find((t) => t.lap.chosen.length >= best.lap.chosen.length && !t.lap.overloaded);
          ship = (smaller ?? best).ship;
          lap = (smaller ?? best).lap;
        } else {
          const best = tries.reduce((a, b) => (coverDays([allStops[start]], b.ship).days > coverDays([allStops[start]], a.ship).days ? b : a));
          ship = best.ship;
          lap = best.lap;
        }
        left.set(ship.id, left.get(ship.id)! - 1);
      }
      lap.chosen.forEach((i) => open.delete(i));

      const { trunk, dist, prev } = lap;
      const onLap = new Set(trunk);
      const sideEdges: [number, number][] = [];
      let detourJumps = 0;
      for (const system of new Set(lap.chosen.map((i) => allStops[i].system))) {
        detourJumps += dist.get(system)!;
        for (let i = system; dist.get(i)! > 0; i = prev.get(i)!) {
          if (!onLap.has(i)) sideEdges.push([i, prev.get(i)!]);
          onLap.add(i);
        }
      }

      const lapCover = cover(lap.order(lap.chosen), ship);
      const limits = lap.chosen.map((i) => lap.routeOf(i).gatewayLimit).filter((l): l is number => l !== null);
      const gatewayLimit = limits.length > 0 ? Math.min(...limits) : null;
      const { days, binding, transfers } = lapCover;
      const { stops, load } = mergeStops(lapCover.ordered);
      const edgeKeys = new Set<string>();
      const edges: [number, number][] = [];
      const gatewayEdges: [number, number][] = [];
      const addEdge = (edge: [number, number]) => {
        const key = edgeKey(edge);
        if (edgeKeys.has(key)) return;
        edgeKeys.add(key);
        (lap.paths.gatewayKeys.has(key) ? gatewayEdges : edges).push(edge);
      };
      // Stops on the start's path share its edges; the rest hang off side trips.
      for (let i = 0; i + 1 < trunk.length; i++) addEdge([trunk[i], trunk[i + 1]]);
      sideEdges.forEach(addEdge);
      planned.push({
        exchange,
        ship,
        stops,
        load,
        coverDays: days,
        binding,
        lapJumps: 2 * Math.max(...lap.chosen.map((i) => lap.routeOf(i).jumps)) + 2 * detourJumps,
        overloaded: lap.overloaded,
        gatewayLimit,
        gatewayBlocked: gatewayLimit !== null && ship.volume > gatewayLimit,
        systems: [...onLap],
        edges,
        gatewayEdges,
        transfers,
      });
    }
  }
  return planned.sort((a, b) => a.exchange - b.exchange || b.load.inT - a.load.inT);
}

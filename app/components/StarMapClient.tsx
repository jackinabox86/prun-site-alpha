"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  EXCHANGES,
  computeEmpire,
  findExchange,
  loadGateways,
  loadPlanetNames,
  loadStarSystems,
  makeResolver,
  splitList,
  type Empire,
  type GatewayData,
  type GatewayLink,
  type Exchange,
  type StarSystem,
} from "@/lib/starMap";
import {
  SHIP_SIZES,
  betterScore,
  formatFleet,
  loadMaterialSizes,
  loadsByBase,
  parseBurn,
  parseFleet,
  planRoutes,
  planScore,
  type MaterialSize,
  type PlannedRoute,
} from "@/lib/routePlan";

// World-unit diameters. Neighbouring systems are ~50-100 units apart.
const STAR_SIZE = 37.5;
const EXCHANGE_SIZE = 112.5;
const MIN_POINT_PX = 6.25;
const HOVER_RADIUS_PX = 12;
// The galaxy disk is thin (game Z spans ~130 units); exaggerate its height
// so the depth reads clearly when orbiting. Deliberately not to scale.
const VERTICAL_SCALE = 2;

// Jump connections fade in between these fractions of the starting camera
// distance, so they never clutter the zoomed-out view.
const LINK_FADE_START = 0.4;
const LINK_FADE_END = 0.25;
const LINK_OPACITY = 0.16;
const ROUTE_OPACITY = 0.5;

// Base markers: a faint yellow ring with one dot per base in the system.
const BASE_COLOR = "#ffd84a";
const GATEWAY_COLOR = "#4ff0ff";
const GATEWAY_OPACITY = 0.55;
const NO_GATEWAYS: GatewayLink[] = [];
const BASE_RING_SIZE = 57.5;
// Hovering a base lights its route to the exchange along the jump lines.
const HIGHLIGHT_COLOR = "#fff3b0";
const HIGHLIGHT_GATEWAY_COLOR = "#b8fbff";
const MILK_COLOR = "#9be37a";
const MAX_BASE_DOTS = 12;

const FLY_MS = 900;
const FLY_DISTANCE = 260;
const BASES_STORAGE_KEY = "starMap.bases";
const EXCHANGE_STORAGE_KEY = "starMap.exchange";
const GATEWAYS_STORAGE_KEY = "starMap.gateways";
/** Older builds kept the burn paste in its own box; it now lives in the bases box. */
const BURN_STORAGE_KEY = "starMap.burn";
/** New key so the fleet becomes the default even where a single hold was saved. */
const SHIP_STORAGE_KEY = "starMap.shipHold";
const MIN_DAYS_STORAGE_KEY = "starMap.minDays";
const FLEET_STORAGE_KEY = "starMap.fleet";
/** System names whose bases route on jump lines only. */
const NO_GATEWAY_STORAGE_KEY = "starMap.noGateway";
/** "System>AI1" lines: bases sent to an exchange other than the nearest. */
const EXCHANGE_FOR_STORAGE_KEY = "starMap.exchangeFor";
const MILK_STORAGE_KEY = "starMap.milkRuns";
const INFO_COLLAPSED_STORAGE_KEY = "starMap.infoCollapsed";
/** Ship hold option that plans with the counts in the fleet box. */
const FLEET_OPTION = "fleet";
const DEFAULT_MIN_DAYS = 7;
const GL_UNAVAILABLE = "The browser blocked 3D graphics for this page. Reload it; if that fails, restart the browser.";
const GL_LOST = "Lost the 3D graphics context. Waiting for the browser to restore it…";

// Soft spectral tints for ordinary stars, kept pale so the saturated
// exchange colors stay distinct from every ordinary star.
const SPECTRAL_TINT: Record<string, string> = {
  O: "#9bb0ff",
  B: "#aabfff",
  A: "#cad7ff",
  F: "#f8f7ff",
  G: "#fff4ea",
  K: "#ffd2a1",
  M: "#ffbd8a",
};
const BASE_STAR_COLOR = new THREE.Color("#dfe8ff");
const TINT_AMOUNT = 0.3;

const vertexShader = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  attribute float visible;
  uniform float uScale;
  uniform float uMinPx;
  uniform int uHovered;
  varying vec3 vColor;
  varying float vVisible;
  void main() {
    vColor = color;
    vVisible = visible;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float s = size * (gl_VertexID == uHovered ? 1.8 : 1.0);
    gl_PointSize = visible > 0.5 ? clamp(s * uScale / -mv.z, uMinPx, 96.0) : 0.0;
    gl_Position = projectionMatrix * mv;
  }
`;

// A crisp bright core with a light halo; additive blending makes it glow.
const fragmentShader = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vVisible;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0 || vVisible < 0.5) discard;
    float core = smoothstep(0.28, 0.16, d);
    float halo = pow(1.0 - d, 4.0) * 0.42;
    float a = (core + halo) * uOpacity;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

const baseVertexShader = /* glsl */ `
  attribute float count;
  uniform float uScale;
  varying float vCount;
  void main() {
    vCount = count;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(${BASE_RING_SIZE.toFixed(1)} * uScale / -mv.z, 10.0, 60.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const baseFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vCount;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float a = smoothstep(0.07, 0.0, abs(d - 0.82)) * 0.4;
    if (vCount > 0.5) {
      for (int k = 0; k < ${MAX_BASE_DOTS}; k++) {
        if (float(k) >= vCount) break;
        float ang = 6.2831853 * float(k) / vCount - 1.5707963;
        vec2 p = 0.41 * vec2(cos(ang), sin(ang));
        a = max(a, smoothstep(0.11, 0.07, length(c - p)) * 0.95);
      }
    }
    gl_FragColor = vec4(uColor * a, a);
  }
`;

function makePointsMaterial(opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uScale: { value: 1 },
      uMinPx: { value: MIN_POINT_PX },
      uHovered: { value: -1 },
      uOpacity: { value: opacity },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// Game coordinates put the galaxy disk in the X/Y plane with Z thin. Rotate
// so the disk lies on three.js's ground plane and orbiting feels natural.
function toWorld(s: StarSystem, out: THREE.Vector3): THREE.Vector3 {
  return out.set(s.x, s.z * VERTICAL_SCALE, -s.y);
}

function segmentPositions(positions: Float32Array, edges: [number, number][]): Float32Array {
  const out = new Float32Array(edges.length * 6);
  edges.forEach(([a, b], k) => {
    out.set(positions.subarray(a * 3, a * 3 + 3), k * 6);
    out.set(positions.subarray(b * 3, b * 3 + 3), k * 6 + 3);
  });
  return out;
}

interface HoverInfo {
  index: number;
  left: number;
  top: number;
}

/** Imperative handle onto the three.js scene, set while it is mounted. */
interface SceneApi {
  flyToSystem: (index: number) => void;
  setBases: (counts: Map<number, number>) => void;
  setEmpire: (empire: Empire | null) => void;
  setGateways: (edges: [number, number][]) => void;
  /** Each base system's path to its exchange, lit while the base is hovered. */
  setBasePaths: (paths: Map<number, number[]>) => void;
}

interface Bases {
  /** Planet labels per base system. */
  bySystem: Map<number, string[]>;
  /** Exchanges pinned per base system with "Base > AI1". */
  pinned: Map<number, Exchange>;
  unresolved: string[];
}

/** A text setting kept in this browser's localStorage. */
function useStoredText(key: string, initial = ""): [string, (text: string) => void] {
  const [text, setText] = useState(initial);
  useEffect(() => {
    setText(window.localStorage.getItem(key) ?? initial);
  }, [key, initial]);
  const update = (next: string) => {
    setText(next);
    window.localStorage.setItem(key, next);
  };
  return [text, update];
}

export default function StarMapClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneApi = useRef<SceneApi | null>(null);
  const [systems, setSystems] = useState<StarSystem[] | null>(null);
  const [planetNames, setPlanetNames] = useState<Map<string, string>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [query, setQuery] = useState("");
  const [queryError, setQueryError] = useState<string | null>(null);
  const [basesText, updateBasesText] = useStoredText(BASES_STORAGE_KEY);
  const [exchangeCode, setExchangeCode] = useStoredText(EXCHANGE_STORAGE_KEY);
  const [shipId, setShipId] = useStoredText(SHIP_STORAGE_KEY, FLEET_OPTION);
  const [minDaysText, setMinDaysText] = useStoredText(MIN_DAYS_STORAGE_KEY, String(DEFAULT_MIN_DAYS));
  const [fleetText, setFleetText] = useStoredText(FLEET_STORAGE_KEY);
  const [materialSizes, setMaterialSizes] = useState<Map<string, MaterialSize>>(() => new Map());
  const [gatewayData, setGatewayData] = useState<GatewayData>({ links: [], source: "none" });
  const [gatewaysOffText, setGatewaysOffText] = useStoredText(GATEWAYS_STORAGE_KEY);
  const useGateways = gatewaysOffText !== "off";
  const [noGatewayText, setNoGatewayText] = useStoredText(NO_GATEWAY_STORAGE_KEY);
  const [exchangeForText, setExchangeForText] = useStoredText(EXCHANGE_FOR_STORAGE_KEY);
  const [milkOffText, setMilkOffText] = useStoredText(MILK_STORAGE_KEY);
  const milkOn = milkOffText !== "off";
  const [infoCollapsedText, setInfoCollapsedText] = useStoredText(INFO_COLLAPSED_STORAGE_KEY);
  const infoCollapsed = infoCollapsedText === "1";
  const [empireOn, setEmpireOn] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadStarSystems(), loadPlanetNames(), loadMaterialSizes()])
      .then(([s, names, sizes]) => {
        if (cancelled) return;
        setPlanetNames(names);
        setMaterialSizes(sizes);
        setSystems(s);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!systems) return;
    let cancelled = false;
    loadGateways(systems).then((data) => !cancelled && setGatewayData(data));
    return () => {
      cancelled = true;
    };
  }, [systems]);
  const gateways = useGateways ? gatewayData.links : NO_GATEWAYS;

  const resolve = useMemo(() => (systems ? makeResolver(systems, planetNames) : null), [systems, planetNames]);

  // One box takes planet names, a pasted burn table, or both: tab-separated
  // lines are burn rows, every other line is a list of bases.
  const { listText, burnText } = useMemo(() => {
    const lines = basesText.split(/\r?\n/);
    return {
      listText: lines.filter((l) => !l.includes("\t")).join("\n"),
      burnText: lines.filter((l) => l.includes("\t")).join("\n"),
    };
  }, [basesText]);
  const burn = useMemo(() => parseBurn(burnText, materialSizes), [burnText, materialSizes]);

  // Moves a burn paste saved by an older build into the bases box, once.
  useEffect(() => {
    const oldBurn = window.localStorage.getItem(BURN_STORAGE_KEY);
    if (!oldBurn) return;
    window.localStorage.removeItem(BURN_STORAGE_KEY);
    const current = window.localStorage.getItem(BASES_STORAGE_KEY) ?? "";
    if (!current.includes("\t")) updateBasesText(current ? `${current}\n${oldBurn}` : oldBurn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bases come from the bases box and from the planets in a pasted burn table.
  const bases = useMemo<Bases>(() => {
    const bySystem = new Map<number, string[]>();
    const pinned = new Map<number, Exchange>();
    const unresolved: string[] = [];
    if (!resolve) return { bySystem, pinned, unresolved };
    const add = (system: number, label: string) => {
      const labels = bySystem.get(system) ?? [];
      if (!labels.includes(label)) labels.push(label);
      bySystem.set(system, labels);
    };
    for (const entry of splitList(listText)) {
      const [name, pin] = entry.split(">").map((t) => t.trim());
      const hit = resolve(name);
      const exchange = pin === undefined ? null : findExchange(pin);
      if (!hit || (pin !== undefined && !exchange)) {
        unresolved.push(entry);
        continue;
      }
      add(hit.system, hit.label);
      if (exchange) pinned.set(hit.system, exchange);
    }
    for (const base of burn.bases) {
      const hit = resolve(base.planet);
      if (hit) add(hit.system, hit.label);
      else unresolved.push(base.planet);
    }
    return { bySystem, pinned, unresolved };
  }, [resolve, listText, burn]);

  // Bases opted out of gateways, kept by system name so the list survives edits to the bases box.
  const noGateways = useMemo(() => {
    const names = new Set(splitList(noGatewayText));
    return new Set((systems ?? []).flatMap((s, i) => (names.has(s.name) ? [i] : [])));
  }, [systems, noGatewayText]);
  const toggleGateway = (system: number) => {
    if (!systems) return;
    const names = new Set(splitList(noGatewayText));
    const name = systems[system].name;
    if (names.has(name)) names.delete(name);
    else names.add(name);
    setNoGatewayText([...names].join("\n"));
  };

  // Exchanges chosen per system in empire view, kept by system name like the gateway opt-outs.
  const exchangeFor = useMemo(() => {
    const byName = new Map<string, Exchange>();
    for (const line of exchangeForText.split(/\r?\n/)) {
      const [name, code] = line.split(">");
      const exchange = code ? findExchange(code) : null;
      if (name?.trim() && exchange) byName.set(name.trim(), exchange);
    }
    const bySystem = new Map<number, Exchange>();
    (systems ?? []).forEach((s, i) => {
      const exchange = byName.get(s.name);
      if (exchange) bySystem.set(i, exchange);
    });
    return bySystem;
  }, [systems, exchangeForText]);
  const setExchangeFor = (system: number, code: string) => {
    if (!systems) return;
    const name = systems[system].name;
    const lines = exchangeForText.split(/\r?\n/).filter((l) => l.trim() && l.split(">")[0].trim() !== name);
    if (code) lines.push(`${name}>${code}`);
    setExchangeForText(lines.join("\n"));
  };

  const homeExchange = findExchange(exchangeCode);
  const empire = useMemo(
    () =>
      systems && bases.bySystem.size > 0
        ? computeEmpire(
            systems,
            [...bases.bySystem.keys()],
            (base) => exchangeFor.get(base) ?? bases.pinned.get(base) ?? homeExchange,
            gateways,
            noGateways,
          )
        : null,
    [systems, bases, exchangeFor, homeExchange, gateways, noGateways],
  );

  const useFleet = shipId === FLEET_OPTION;
  const ship = SHIP_SIZES.find((x) => x.id === shipId) ?? SHIP_SIZES[0];
  const fleet = useMemo(() => parseFleet(fleetText), [fleetText]);
  const fleetSize = [...fleet.values()].reduce((a, b) => a + b, 0);
  const minDays = Math.max(0, parseFloat(minDaysText) || 0);
  // Plans with and without milk runs; milk runs are only suggested when they
  // serve more bases or need fewer ships than dropping everything at the exchange.
  const plans = useMemo<{ base: PlannedRoute[]; milk: PlannedRoute[] | null }>(() => {
    if (!systems || !resolve || !empire || burn.bases.length === 0) return { base: [], milk: null };
    // A ship only takes gateways its volume fits, so bigger ships may fly the
    // jump lines instead; each base keeps the exchange the empire view gave it.
    const exchangeOf = new Map(empire.routes.map((r) => [r.base, systems[r.exchange].exchange]));
    const empireFor = (volume: number) =>
      computeEmpire(
        systems,
        [...exchangeOf.keys()],
        (base) => exchangeOf.get(base) ?? null,
        gateways.filter((g) => g.maxShipVolume >= volume),
        noGateways,
      );
    const stops = loadsByBase(burn.bases, resolve).stops;
    const ships = useFleet ? fleet : ship;
    const base = planRoutes(systems, empire, stops, ships, minDays, empireFor);
    const milk = planRoutes(systems, empire, stops, ships, minDays, empireFor, true);
    return { base, milk: betterScore(planScore(milk), planScore(base)) ? milk : null };
  }, [systems, resolve, empire, burn, useFleet, fleet, ship, minDays, gateways, noGateways]);
  const plan = milkOn && plans.milk ? plans.milk : plans.base;
  const setFleetCount = (id: string, n: number) => {
    const next = new Map(fleet);
    next.set(id, n);
    setFleetText(formatFleet(parseFleet(formatFleet(next))));
  };
  useEffect(() => setSelectedRoute(null), [plan]);

  // A selected route narrows empire view to that one lap.
  const shownEmpire = useMemo<Empire | null>(() => {
    const route = selectedRoute === null ? undefined : plan[selectedRoute];
    if (!empire || !route) return empire;
    const stops = new Set(route.stops.map((s) => s.system));
    return {
      routes: empire.routes.filter((r) => stops.has(r.base)),
      systems: new Set(route.systems),
      edges: route.edges,
      gatewayEdges: route.gatewayEdges,
    };
  }, [empire, plan, selectedRoute]);
  const empireActive = empireOn && shownEmpire !== null;

  const suggestions = useMemo(() => {
    if (!systems) return [];
    const names = new Set(systems.map((s) => s.name));
    planetNames.forEach((name) => names.add(name));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [systems, planetNames]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !systems || systems.length === 0) return;

    // The browser can refuse a WebGL context (e.g. after a GPU reset). Show a
    // message instead of letting the throw take down the whole page.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError(GL_UNAVAILABLE);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 1, 30000);

    // Star geometry, centred on the cloud's bounding-box centre.
    const positions = new Float32Array(systems.length * 3);
    const colors = new Float32Array(systems.length * 3);
    const sizes = new Float32Array(systems.length);
    const visible = new Float32Array(systems.length).fill(1);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    systems.forEach((s) => box.expandByPoint(toWorld(s, v)));
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const color = new THREE.Color();
    systems.forEach((s, i) => {
      toWorld(s, v).sub(center).toArray(positions, i * 3);
      if (s.exchange) {
        color.set(s.exchange.color);
      } else {
        color.copy(BASE_STAR_COLOR).lerp(new THREE.Color(SPECTRAL_TINT[s.type] ?? "#ffffff"), TINT_AMOUNT);
      }
      color.toArray(colors, i * 3);
      sizes[i] = s.exchange ? EXCHANGE_SIZE : STAR_SIZE;
    });
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    starGeometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    const visibleAttr = new THREE.BufferAttribute(visible, 1);
    starGeometry.setAttribute("visible", visibleAttr);
    const starMaterial = makePointsMaterial(1);
    scene.add(new THREE.Points(starGeometry, starMaterial));

    // Every jump connection once, drawn very faintly when zoomed in.
    const linkEdges: [number, number][] = [];
    systems.forEach((s, i) => s.neighbors.forEach((j) => i < j && linkEdges.push([i, j])));
    const linkGeometry = new THREE.BufferGeometry();
    linkGeometry.setAttribute("position", new THREE.BufferAttribute(segmentPositions(positions, linkEdges), 3));
    const linkMaterial = new THREE.LineBasicMaterial({
      color: "#9fb4e6",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const links = new THREE.LineSegments(linkGeometry, linkMaterial);
    links.visible = false;
    scene.add(links);

    // Empire routes, replaced whenever the empire changes.
    const routeMaterial = new THREE.LineBasicMaterial({
      color: BASE_COLOR,
      transparent: true,
      opacity: ROUTE_OPACITY,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const routes = new THREE.LineSegments(new THREE.BufferGeometry(), routeMaterial);
    routes.visible = false;
    scene.add(routes);

    // Gateway jumps: every working pair on the full map, only the empire's own
    // in empire view.
    const gatewayMaterial = new THREE.LineBasicMaterial({
      color: GATEWAY_COLOR,
      transparent: true,
      opacity: GATEWAY_OPACITY,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const gatewayLines = new THREE.LineSegments(new THREE.BufferGeometry(), gatewayMaterial);
    scene.add(gatewayLines);
    let allGatewayEdges: [number, number][] = [];
    const showGatewayEdges = (edges: [number, number][]) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(segmentPositions(positions, edges), 3));
      gatewayLines.geometry.dispose();
      gatewayLines.geometry = geometry;
      invalidate();
    };

    // Base markers, replaced whenever the base list changes.
    const baseMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: baseFragmentShader,
      uniforms: { uScale: { value: 1 }, uColor: { value: new THREE.Color(BASE_COLOR) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const baseMarkers = new THREE.Points(new THREE.BufferGeometry(), baseMaterial);
    scene.add(baseMarkers);

    // The hovered base's route, drawn bright over everything else.
    const highlightMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const highlight = new THREE.LineSegments(new THREE.BufferGeometry(), highlightMaterial);
    highlight.renderOrder = 1;
    scene.add(highlight);
    let basePaths = new Map<number, number[]>();
    const lineColor = new THREE.Color(HIGHLIGHT_COLOR);
    const gateColor = new THREE.Color(HIGHLIGHT_GATEWAY_COLOR);
    const showHighlight = (index: number) => {
      const path = basePaths.get(index) ?? [];
      const edges: [number, number][] = [];
      for (let k = 1; k < path.length; k++) edges.push([path[k - 1], path[k]]);
      const edgeColors = new Float32Array(edges.length * 6);
      edges.forEach(([a, b], k) => {
        const c = systems[a].neighbors.includes(b) ? lineColor : gateColor;
        c.toArray(edgeColors, k * 6);
        c.toArray(edgeColors, k * 6 + 3);
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(segmentPositions(positions, edges), 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(edgeColors, 3));
      highlight.geometry.dispose();
      highlight.geometry = geometry;
    };

    // System names beside base systems, shown once zoomed in.
    const labelLayer = document.createElement("div");
    labelLayer.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none";
    container.appendChild(labelLayer);
    let labels: { index: number; el: HTMLDivElement }[] = [];

    // Faint, non-interactive background dust far outside the map.
    const dustCount = 1800;
    const dustPositions = new Float32Array(dustCount * 3);
    const dustColors = new Float32Array(dustCount * 3);
    const dustSizes = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
      v.randomDirection().multiplyScalar(radius * (4 + Math.random() * 3));
      v.toArray(dustPositions, i * 3);
      color.setHSL(0.6 + Math.random() * 0.1, 0.3, 0.55 + Math.random() * 0.3).toArray(dustColors, i * 3);
      dustSizes[i] = 20 + Math.random() * 30;
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    dustGeometry.setAttribute("color", new THREE.BufferAttribute(dustColors, 3));
    dustGeometry.setAttribute("size", new THREE.BufferAttribute(dustSizes, 1));
    dustGeometry.setAttribute("visible", new THREE.BufferAttribute(new Float32Array(dustCount).fill(1), 1));
    const dustMaterial = makePointsMaterial(0.35);
    dustMaterial.uniforms.uMinPx.value = 1;
    scene.add(new THREE.Points(dustGeometry, dustMaterial));

    const homePosition = new THREE.Vector3(0, radius * 0.55, radius * 0.45);
    const homeDistance = homePosition.length();
    camera.position.copy(homePosition);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.minDistance = 40;
    controls.maxDistance = radius * 4;
    controls.target.set(0, 0, 0);
    controls.update();

    // Render only when something changed, so an idle map leaves the GPU alone.
    let dirty = true;
    const invalidate = () => {
      dirty = true;
    };
    controls.addEventListener("change", invalidate);

    // three.js asks the browser to restore a lost context; say so meanwhile.
    const onContextLost = () => setError(GL_LOST);
    const onContextRestored = () => {
      setError(null);
      invalidate();
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Pixels per world unit at distance 1, in drawing-buffer pixels.
      const scale = (h * renderer.getPixelRatio()) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      starMaterial.uniforms.uScale.value = scale;
      dustMaterial.uniforms.uScale.value = scale;
      baseMaterial.uniforms.uScale.value = scale;
      invalidate();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    // Camera flights: ease the orbit target and camera toward a destination.
    // Any user input on the controls cancels the flight.
    let flight: {
      start: number;
      fromTarget: THREE.Vector3;
      fromCamera: THREE.Vector3;
      toTarget: THREE.Vector3;
      toCamera: THREE.Vector3;
    } | null = null;
    const flyTo = (target: THREE.Vector3, distance: number) => {
      const dir = camera.position.clone().sub(controls.target).normalize();
      flight = {
        start: performance.now(),
        fromTarget: controls.target.clone(),
        fromCamera: camera.position.clone(),
        toTarget: target.clone(),
        toCamera: target.clone().addScaledVector(dir, distance),
      };
    };
    const cancelFlight = () => {
      flight = null;
    };
    controls.addEventListener("start", cancelFlight);

    // Hover: project every star to screen space and take the nearest within
    // reach. 698 projections per pointer move is cheap and avoids ray
    // thresholds that change with zoom.
    let pointer: { x: number; y: number } | null = null;
    let dragging = false;
    let hoveredIndex = -1;
    const projected = new THREE.Vector3();
    const pick = () => {
      let best = -1;
      if (pointer && !dragging) {
        const w = container.clientWidth;
        const h = container.clientHeight;
        let bestDist = Infinity;
        for (let i = 0; i < systems.length; i++) {
          if (visible[i] < 0.5) continue;
          projected.fromArray(positions, i * 3);
          const depth = projected.clone().applyMatrix4(camera.matrixWorldInverse).z;
          if (depth >= 0) continue; // behind the camera
          projected.project(camera);
          const sx = ((projected.x + 1) / 2) * w;
          const sy = ((1 - projected.y) / 2) * h;
          const dist = Math.hypot(sx - pointer.x, sy - pointer.y);
          const reach = Math.max(HOVER_RADIUS_PX, (sizes[i] * starMaterial.uniforms.uScale.value) / renderer.getPixelRatio() / -depth / 2);
          if (dist <= reach && dist < bestDist) {
            bestDist = dist;
            best = i;
          }
        }
      }
      if (best !== hoveredIndex) {
        hoveredIndex = best;
        starMaterial.uniforms.uHovered.value = best;
        showHighlight(best);
        renderer.domElement.style.cursor = best >= 0 ? "pointer" : "grab";
        invalidate();
      }
      if (best >= 0 && pointer) {
        setHover({ index: best, left: pointer.x, top: pointer.y });
      } else {
        setHover(null);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      dragging = e.buttons !== 0;
      pick();
    };
    const onPointerLeave = () => {
      pointer = null;
      pick();
    };
    const el = renderer.domElement;
    el.style.cursor = "grab";
    el.style.display = "block";
    el.style.width = "100%";
    el.style.height = "100%";
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerleave", onPointerLeave);

    let empireShown = false;
    sceneApi.current = {
      flyToSystem: (index) => {
        flyTo(v.fromArray(positions, index * 3), Math.min(FLY_DISTANCE, camera.position.distanceTo(controls.target)));
      },
      setBases: (counts) => {
        const pos = new Float32Array(counts.size * 3);
        const cnt = new Float32Array(counts.size);
        let k = 0;
        counts.forEach((n, i) => {
          pos.set(positions.subarray(i * 3, i * 3 + 3), k * 3);
          cnt[k++] = Math.min(n, MAX_BASE_DOTS);
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geometry.setAttribute("count", new THREE.BufferAttribute(cnt, 1));
        baseMarkers.geometry.dispose();
        baseMarkers.geometry = geometry;
        labelLayer.replaceChildren();
        labels = [...counts.keys()].map((index) => {
          const el = document.createElement("div");
          el.textContent = systems[index].name;
          el.style.cssText = `position:absolute;left:0;top:0;display:none;color:${BASE_COLOR};font:11px var(--font-mono);white-space:nowrap;text-shadow:0 0 3px #000,0 0 6px #000`;
          labelLayer.appendChild(el);
          return { index, el };
        });
        invalidate();
      },
      setEmpire: (empire) => {
        visible.fill(empire ? 0 : 1);
        empire?.systems.forEach((i) => (visible[i] = 1));
        visibleAttr.needsUpdate = true;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(segmentPositions(positions, empire?.edges ?? []), 3));
        routes.geometry.dispose();
        routes.geometry = geometry;
        routes.visible = empire !== null;
        showGatewayEdges(empire ? empire.gatewayEdges : allGatewayEdges);
        if (empire) {
          // Frame everything the empire view shows.
          const sphere = new THREE.Sphere().setFromPoints([...empire.systems].map((i) => new THREE.Vector3().fromArray(positions, i * 3)));
          flyTo(sphere.center, Math.max(FLY_DISTANCE, sphere.radius * 2.4));
        } else if (empireShown) {
          flyTo(new THREE.Vector3(), homeDistance);
        }
        empireShown = empire !== null;
        invalidate();
        pick();
      },
      setGateways: (edges) => {
        allGatewayEdges = edges;
        if (!empireShown) showGatewayEdges(edges);
      },
      setBasePaths: (paths) => {
        basePaths = paths;
        showHighlight(hoveredIndex);
        invalidate();
      },
    };

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      let moved = false;
      if (flight) {
        const t = Math.min(1, (performance.now() - flight.start) / FLY_MS);
        const ease = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        controls.target.lerpVectors(flight.fromTarget, flight.toTarget, ease);
        camera.position.lerpVectors(flight.fromCamera, flight.toCamera, ease);
        if (t === 1) flight = null;
        moved = true;
      }
      // Damping keeps the camera moving after a drag ends, so keep the
      // hovered star in sync with what is under the pointer.
      if (controls.update() || moved) {
        dirty = true;
        if (pointer && !dragging) pick();
      }
      if (!dirty) return;
      dirty = false;
      const distance = camera.position.distanceTo(controls.target) / homeDistance;
      const fade = THREE.MathUtils.clamp((LINK_FADE_START - distance) / (LINK_FADE_START - LINK_FADE_END), 0, 1);
      linkMaterial.opacity = fade * LINK_OPACITY;
      links.visible = fade > 0 && !empireShown;
      const labelsOn = distance < LINK_FADE_START;
      const w = container.clientWidth;
      const h = container.clientHeight;
      for (const { index, el } of labels) {
        projected.fromArray(positions, index * 3).applyMatrix4(camera.matrixWorldInverse);
        const ahead = projected.z < 0;
        projected.fromArray(positions, index * 3).project(camera);
        const x = ((projected.x + 1) / 2) * w;
        const y = ((1 - projected.y) / 2) * h;
        const show = labelsOn && ahead && visible[index] > 0.5 && x > -200 && x < w && y > -20 && y < h + 20;
        el.style.display = show ? "block" : "none";
        if (show) el.style.transform = `translate(${(x + 12).toFixed(1)}px, ${(y - 7).toFixed(1)}px)`;
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      sceneApi.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerleave", onPointerLeave);
      controls.removeEventListener("start", cancelFlight);
      controls.removeEventListener("change", invalidate);
      el.removeEventListener("webglcontextlost", onContextLost);
      el.removeEventListener("webglcontextrestored", onContextRestored);
      controls.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      linkGeometry.dispose();
      linkMaterial.dispose();
      routes.geometry.dispose();
      routeMaterial.dispose();
      gatewayLines.geometry.dispose();
      gatewayMaterial.dispose();
      baseMarkers.geometry.dispose();
      baseMaterial.dispose();
      highlight.geometry.dispose();
      highlightMaterial.dispose();
      labelLayer.remove();
      dustGeometry.dispose();
      dustMaterial.dispose();
      renderer.dispose();
      el.remove();
    };
  }, [systems]);

  // These run after the scene effect above, so the handle is ready.
  useEffect(() => {
    sceneApi.current?.setGateways(gateways.map((g) => [g.a, g.b]));
  }, [gateways, systems]);
  // Empire view hides every other system, so hide their base rings too.
  useEffect(() => {
    const shown = [...bases.bySystem].filter(([i]) => !empireActive || shownEmpire?.systems.has(i));
    sceneApi.current?.setBases(new Map(shown.map(([i, labels]) => [i, labels.length])));
  }, [systems, bases, empireActive, shownEmpire]);

  useEffect(() => {
    sceneApi.current?.setEmpire(empireActive ? shownEmpire : null);
  }, [systems, shownEmpire, empireActive]);
  useEffect(() => {
    sceneApi.current?.setBasePaths(new Map((empire?.routes ?? []).map((r) => [r.base, r.path])));
  }, [systems, empire]);

  const onZoomSubmit = (e: FormEvent) => {
    e.preventDefault();
    const hit = resolve?.(query);
    if (!hit) {
      setQueryError(query.trim() ? `No planet or system "${query.trim()}"` : null);
      return;
    }
    setQueryError(null);
    if (empireActive && shownEmpire && !shownEmpire.systems.has(hit.system)) setEmpireOn(false);
    sceneApi.current?.flyToSystem(hit.system);
  };

  const hovered = hover && systems ? systems[hover.index] : null;
  const hoveredBases = hover ? bases.bySystem.get(hover.index) : undefined;
  const hoveredRoute = hover ? empire?.routes.find((r) => r.base === hover.index) : undefined;
  const baseCount = [...bases.bySystem.values()].reduce((n, labels) => n + labels.length, 0);

  return (
    <div
      style={{
        position: "relative",
        height: "calc(100vh - 140px)",
        minHeight: 480,
        overflow: "hidden",
        borderRadius: 4,
        background: "radial-gradient(ellipse at 50% 40%, #0d1630 0%, #060a18 55%, #02030a 100%)",
      }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {(error || !systems) && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: error ? "#ff8a80" : "#8fa3c7", fontFamily: "var(--font-mono)" }}>
          {error ?? "Loading star systems…"}
        </div>
      )}

      {hovered && hover && (
        <div
          style={{
            position: "absolute",
            left: hover.left + 14,
            top: hover.top + 14,
            pointerEvents: "none",
            padding: "4px 8px",
            background: "rgba(6, 10, 24, 0.85)",
            border: `1px solid ${hovered.exchange?.color ?? "rgba(160, 185, 255, 0.35)"}`,
            borderRadius: 3,
            color: "#e6edff",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            whiteSpace: "nowrap",
          }}
        >
          {hovered.name}
          {hovered.naturalId && hovered.naturalId !== hovered.name && <span style={{ color: "#8fa3c7" }}> ({hovered.naturalId})</span>}
          {hovered.exchange && <div style={{ color: hovered.exchange.color, fontSize: 11 }}>Commodity exchange {hovered.exchange.code}</div>}
          {hoveredBases && (
            <div style={{ color: BASE_COLOR, fontSize: 11 }}>
              {hoveredBases.length === 1 ? "Base" : `${hoveredBases.length} bases`}: {hoveredBases.map((id) => planetNames.get(id) ?? id).join(", ")}
            </div>
          )}
          {hoveredRoute && systems && (
            <div style={{ color: HIGHLIGHT_COLOR, fontSize: 11 }}>
              Route to {systems[hoveredRoute.exchange].exchange?.code}: {hoveredRoute.jumps} jump{hoveredRoute.jumps === 1 ? "" : "s"}
              {hoveredRoute.gatewayLimit !== null && <span style={{ color: GATEWAY_COLOR }}> via gateway</span>}
            </div>
          )}
        </div>
      )}

      <div style={{ position: "absolute", right: infoCollapsed ? 0 : 12, top: 12, display: "flex", alignItems: "flex-start", pointerEvents: "auto" }}>
        <button
          type="button"
          onClick={() => setInfoCollapsedText(infoCollapsed ? "" : "1")}
          title={infoCollapsed ? "Show the panel" : "Hide the panel"}
          aria-label={infoCollapsed ? "Show the panel" : "Hide the panel"}
          style={collapseHandleStyle}
        >
          {infoCollapsed ? "‹" : "›"}
        </button>
      <div style={{ ...panelStyle, position: "static", width: 260, display: infoCollapsed ? "none" : undefined }}>
        <form onSubmit={onZoomSubmit} style={{ display: "flex", gap: 6 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            list="star-map-places"
            placeholder="Zoom to planet or system"
            aria-label="Zoom to planet or system"
            style={{ ...inputStyle, flex: 1, minWidth: 0 }}
          />
          <button type="submit" style={buttonStyle} disabled={!resolve}>
            Go
          </button>
          <datalist id="star-map-places">
            {suggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </form>
        {queryError && <div style={{ color: "#ff8a80", marginTop: 4 }}>{queryError}</div>}

        <label style={{ display: "block", marginTop: 10, color: "#8fa3c7" }}>
          Your bases (planet names, or paste XIT BURN)
          <textarea
            value={basesText}
            onChange={(e) => updateBasesText(e.target.value)}
            rows={4}
            placeholder={"Montem, Katoa\nUV-351c\nMalahat > AI1\n\nor paste the XIT BURN table"}
            style={{ ...inputStyle, display: "block", width: "100%", marginTop: 4, resize: "vertical" }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, color: "#8fa3c7" }}>
          Exchange
          <select value={homeExchange?.code ?? ""} onChange={(e) => setExchangeCode(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 0 }}>
            <option value="">Nearest by jumps</option>
            {EXCHANGES.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name} ({x.code})
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, color: "#8fa3c7" }}>
          <input type="checkbox" checked={useGateways} onChange={(e) => setGatewaysOffText(e.target.checked ? "" : "off")} />
          Use gateways
          <span style={{ color: "#6f80a3", fontSize: 11 }}>
            {gatewayData.source === "none" ? "(none loaded)" : `(${gatewayData.links.length} working, ${gatewayData.source === "live" ? "live from FIO" : "saved snapshot"})`}
          </span>
        </label>
        <div style={{ color: "#6f80a3", fontSize: 11 }}>Pin one base with &quot;Base &gt; AI1&quot;. A pasted burn table also feeds the route planner.</div>
        <div style={{ color: "#6f80a3", marginTop: 4 }}>
          {baseCount > 0 && `${baseCount} base${baseCount === 1 ? "" : "s"} in ${bases.bySystem.size} system${bases.bySystem.size === 1 ? "" : "s"}`}
          {bases.unresolved.length > 0 && <div style={{ color: "#ff8a80" }}>Not found: {bases.unresolved.join(", ")}</div>}
        </div>

        <button
          type="button"
          onClick={() => setEmpireOn((on) => !on)}
          disabled={!empire}
          style={{
            ...buttonStyle,
            width: "100%",
            marginTop: 8,
            ...(empireActive ? { background: "rgba(255, 216, 74, 0.18)", borderColor: BASE_COLOR, color: BASE_COLOR } : {}),
          }}
        >
          {empireActive ? "Show all systems" : "Empire view"}
        </button>
        {empireActive && shownEmpire && systems && (
          <div style={{ marginTop: 6, color: "#b8c6e6", maxHeight: 220, overflowY: "auto" }}>
            {shownEmpire.routes.map((r) => (
              <div key={r.base}>
                {systems[r.base].name} →{" "}
                <select
                  value={exchangeFor.get(r.base)?.code ?? ""}
                  onChange={(e) => setExchangeFor(r.base, e.target.value)}
                  title="Exchange for this system's bases"
                  aria-label={`Exchange for ${systems[r.base].name}`}
                  style={{ ...exchangeSelectStyle, color: systems[r.exchange].exchange?.color }}
                >
                  <option value="">{exchangeFor.has(r.base) ? "auto" : systems[r.exchange].exchange?.code}</option>
                  {EXCHANGES.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.code}
                    </option>
                  ))}
                </select>{" "}
                <span style={{ color: "#6f80a3" }}>
                  {r.jumps} jump{r.jumps === 1 ? "" : "s"}
                  {r.gatewayLimit !== null && <span style={{ color: GATEWAY_COLOR }}> via gateway</span>}
                  {(exchangeFor.has(r.base) || bases.pinned.has(r.base)) && " (pinned)"}
                </span>
                {gateways.length > 0 && (r.gatewayLimit !== null || noGateways.has(r.base)) && (
                  <button
                    type="button"
                    onClick={() => toggleGateway(r.base)}
                    title={noGateways.has(r.base) ? "Let this base use gateways again" : "Route this base on jump lines only"}
                    style={{ ...linkButtonStyle, color: noGateways.has(r.base) ? GATEWAY_COLOR : "#6f80a3" }}
                  >
                    {noGateways.has(r.base) ? "use gateway" : "skip gateway"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      </div>

      <div style={{ ...panelStyle, left: 12, top: 12, width: plannerOpen ? 340 : undefined, maxHeight: "calc(100% - 210px)", overflowY: "auto", pointerEvents: "auto" }}>
        <button type="button" onClick={() => setPlannerOpen((open) => !open)} style={{ ...buttonStyle, width: plannerOpen ? "100%" : undefined }}>
          {plannerOpen ? "Hide route planner" : "Route planner"}
        </button>
        {plannerOpen && (
          <>
            <div style={{ color: "#6f80a3", marginTop: 8 }}>
              {burn.unknownTickers.length > 0 && <div style={{ color: "#ff8a80" }}>No size for: {burn.unknownTickers.join(", ")}</div>}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <label style={{ flex: 1, color: "#8fa3c7" }}>
                Ship hold
                <select value={useFleet ? FLEET_OPTION : ship.id} onChange={(e) => setShipId(e.target.value)} style={{ ...inputStyle, display: "block", width: "100%" }}>
                  <option value={FLEET_OPTION}>My fleet (fewest ships)</option>
                  {SHIP_SIZES.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ width: 96, color: "#8fa3c7" }}>
                Min days/lap
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={minDaysText}
                  onChange={(e) => setMinDaysText(e.target.value)}
                  style={{ ...inputStyle, display: "block", width: "100%" }}
                />
              </label>
            </div>
            {useFleet && (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: "flex", gap: 4 }}>
                  {SHIP_SIZES.map((x) => (
                    <label key={x.id} style={{ flex: 1, color: "#8fa3c7", fontSize: 11 }}>
                      {x.id}
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={fleet.get(x.id) ?? 0}
                        onChange={(e) => setFleetCount(x.id, Math.max(0, parseInt(e.target.value, 10) || 0))}
                        style={{ ...inputStyle, display: "block", width: "100%" }}
                      />
                    </label>
                  ))}
                </div>
                {burn.bases.length > 0 && <FleetSummary plan={plan} fleetSize={fleetSize} />}
              </div>
            )}
            {burn.bases.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#8fa3c7" }}>
                  <input type="checkbox" checked={milkOn} onChange={(e) => setMilkOffText(e.target.checked ? "" : "off")} />
                  Milk runs
                </label>
                <div style={{ color: plans.milk ? MILK_COLOR : "#6f80a3", fontSize: 11 }}>
                  {plans.milk
                    ? `Passing outputs to bases later on the same lap ${milkSaving(plans.base, plans.milk)}${milkOn ? "" : " Tick to use it."}`
                    : "No saving from passing outputs between bases; they go to the exchange."}
                </div>
              </div>
            )}
            <div style={{ color: "#6f80a3", fontSize: 11, marginTop: 4 }}>
              Each hold leaves the exchange with every stop&apos;s inputs and picks up outputs on the way. Days = how long one hold supplies the
              route. No flight times, so laps are counted in jumps. Click a route to show it.
            </div>
            {burn.bases.length === 0 && <div style={{ marginTop: 6 }}>Paste the XIT BURN table into the bases box to plan routes.</div>}
            {systems &&
              plan.map((r, i) => {
                const selected = selectedRoute === i;
                const exchange = systems[r.exchange].exchange;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setSelectedRoute(selected ? null : i);
                      setEmpireOn(true);
                    }}
                    style={{
                      ...routeCardStyle,
                      borderColor: selected ? BASE_COLOR : r.overloaded || r.gatewayBlocked ? "rgba(255, 138, 128, 0.5)" : "rgba(160, 185, 255, 0.2)",
                    }}
                  >
                    <div>
                      <span style={{ color: exchange?.color }}>{exchange?.code}</span>{" "}
                      {useFleet && <span style={{ color: r.ship ? "#cfd8ee" : "#ff8a80" }}>{r.ship ? r.ship.id : "no ship left"} </span>}
                      {r.ship && <span style={{ color: r.overloaded ? "#ff8a80" : BASE_COLOR }}>{r.coverDays.toFixed(1)} days</span>}{" "}
                      <span style={{ color: "#6f80a3" }}>
                        ({r.binding}) · ~{r.lapJumps} jumps/lap
                      </span>
                    </div>
                    <div>{r.stops.map((stop) => `${systems[stop.system].name} (${stop.planets.join(", ")})`).join(" → ")}</div>
                    <div style={{ color: "#6f80a3" }}>
                      per day in {fmt(r.load.inT)}t / {fmt(r.load.inV)}m³ · out {fmt(r.load.outT)}t / {fmt(r.load.outV)}m³
                    </div>
                    {r.transfers.length > 0 && (
                      <div style={{ color: MILK_COLOR }}>
                        {r.transfers.map((t) => `${t.from} → ${t.to}: ${fmt(t.rate)} ${t.ticker}/day`).join(" · ")}
                      </div>
                    )}
                    {r.overloaded && r.ship && <div style={{ color: "#ff8a80" }}>Under {minDays} days on its own: needs a bigger hold.</div>}
                    {!r.ship && <div style={{ color: "#ff8a80" }}>Every ship in the fleet is already on a route.</div>}
                    {r.ship && r.gatewayLimit !== null && (
                      <div style={{ color: r.gatewayBlocked ? "#ff8a80" : GATEWAY_COLOR }}>
                        {r.gatewayBlocked
                          ? `Hold is ${fmt(r.ship.volume)}m³; a gateway on this lap takes at most ${fmt(r.gatewayLimit)}m³.`
                          : `Uses a gateway (max ${fmt(r.gatewayLimit)}m³ ships).`}
                      </div>
                    )}
                  </button>
                );
              })}
          </>
        )}
      </div>

      <div style={{ ...panelStyle, left: 12, bottom: 12, padding: "4px 8px", fontSize: 11, lineHeight: 1.5, pointerEvents: "none" }}>
        <div style={{ display: "flex", flexWrap: "wrap", columnGap: 12 }}>
          {EXCHANGES.map((x) => (
            <span key={x.code}>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: x.color, boxShadow: `0 0 5px ${x.color}`, marginRight: 5 }} />
              {x.name}
            </span>
          ))}
          {baseCount > 0 && (
            <span>
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", border: `1px solid ${BASE_COLOR}`, marginRight: 5 }} />
              Your bases
            </span>
          )}
          {gateways.length > 0 && (
            <span>
              <span style={{ display: "inline-block", width: 10, height: 2, background: GATEWAY_COLOR, verticalAlign: "middle", marginRight: 5 }} />
              Gateway
            </span>
          )}
        </div>
        <div style={{ color: "#6f80a3" }}>
          {systems ? `${systems.length} systems · ` : ""}drag rotate · right-drag pan · scroll zoom
        </div>
      </div>
    </div>
  );
}

/** Ships used against the fleet, by size, and what is left over. */
function FleetSummary({ plan, fleetSize }: { plan: PlannedRoute[]; fleetSize: number }) {
  const used = new Map<string, number>();
  for (const r of plan) if (r.ship) used.set(r.ship.id, (used.get(r.ship.id) ?? 0) + 1);
  const usedCount = [...used.values()].reduce((a, b) => a + b, 0);
  const baseCount = (routes: PlannedRoute[]) => routes.reduce((n, r) => n + r.stops.reduce((m, s) => m + s.planets.length, 0), 0);
  const unserved = baseCount(plan.filter((r) => !r.ship));
  const short = plan.filter((r) => r.ship && r.overloaded).length;
  const routes = plan.filter((r) => r.ship).length;
  return (
    <div style={{ marginTop: 4 }}>
      {usedCount} of {fleetSize} ships on {routes} route{routes === 1 ? "" : "s"}
      {used.size > 0 && ` (${SHIP_SIZES.filter((s) => used.has(s.id)).map((s) => `${used.get(s.id)}× ${s.id}`).join(", ")})`}.
      {unserved > 0 && <div style={{ color: "#ff8a80" }}>{unserved === 1 ? "1 base has" : `${unserved} bases have`} no ship: add ships.</div>}
      {short > 0 && <div style={{ color: "#ff8a80" }}>{short} routes fall short of the minimum days even with the biggest ship left.</div>}
    </div>
  );
}

/** What a milk-run plan gains over dropping every output at the exchange. */
function milkSaving(base: PlannedRoute[], milk: PlannedRoute[]): string {
  const [unservedB, shortB, shipsB, jumpsB] = planScore(base);
  const [unservedM, shortM, shipsM, jumpsM] = planScore(milk);
  if (unservedM < unservedB) return `gives ${unservedB - unservedM} more base${unservedB - unservedM === 1 ? "" : "s"} a ship.`;
  if (shortM < shortB) return `lifts ${shortB - shortM} base${shortB - shortM === 1 ? "" : "s"} over the minimum days.`;
  if (shipsM < shipsB) return `uses ${shipsM} ships instead of ${shipsB}.`;
  return `cuts laps from ${jumpsB} to ${jumpsM} jumps in total.`;
}

const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));

const exchangeSelectStyle: CSSProperties = {
  padding: "0 2px",
  background: "rgba(2, 4, 12, 0.8)",
  border: "1px solid rgba(160, 185, 255, 0.25)",
  borderRadius: 2,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
};

const collapseHandleStyle: CSSProperties = {
  width: 16,
  height: 48,
  padding: 0,
  background: "rgba(6, 10, 24, 0.7)",
  border: "1px solid rgba(160, 185, 255, 0.2)",
  borderRight: "none",
  borderRadius: "3px 0 0 3px",
  color: "#8fa3c7",
  fontSize: 14,
  cursor: "pointer",
};

const linkButtonStyle: CSSProperties = {
  marginLeft: 6,
  padding: 0,
  background: "none",
  border: "none",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  textDecoration: "underline",
  cursor: "pointer",
};

const routeCardStyle: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 6,
  padding: "4px 6px",
  textAlign: "left",
  background: "rgba(2, 4, 12, 0.6)",
  border: "1px solid",
  borderRadius: 2,
  color: "#b8c6e6",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  lineHeight: 1.5,
  cursor: "pointer",
};

const panelStyle: CSSProperties = {
  position: "absolute",
  padding: "8px 10px",
  background: "rgba(6, 10, 24, 0.7)",
  border: "1px solid rgba(160, 185, 255, 0.2)",
  borderRadius: 3,
  color: "#b8c6e6",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  lineHeight: 1.6,
};

const inputStyle: CSSProperties = {
  boxSizing: "border-box",
  padding: "4px 6px",
  background: "rgba(2, 4, 12, 0.8)",
  border: "1px solid rgba(160, 185, 255, 0.3)",
  borderRadius: 2,
  color: "#e6edff",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
};

const buttonStyle: CSSProperties = {
  padding: "4px 10px",
  background: "rgba(160, 185, 255, 0.1)",
  border: "1px solid rgba(160, 185, 255, 0.35)",
  borderRadius: 2,
  color: "#e6edff",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  cursor: "pointer",
};

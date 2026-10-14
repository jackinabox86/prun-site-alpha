"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  EXCHANGES,
  computeEmpire,
  findExchange,
  loadPlanetNames,
  loadStarSystems,
  makeResolver,
  splitList,
  type Empire,
  type Exchange,
  type StarSystem,
} from "@/lib/starMap";
import {
  SHIP_SIZES,
  loadMaterialSizes,
  loadsBySystem,
  parseBurn,
  planRoutes,
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

// Base markers: a faint yellow ring, plus one dot per base when a system
// holds more than one.
const BASE_COLOR = "#ffd84a";
const BASE_RING_SIZE = 57.5;
const MAX_BASE_DOTS = 12;

const FLY_MS = 900;
const FLY_DISTANCE = 260;
const BASES_STORAGE_KEY = "starMap.bases";
const EXCHANGE_STORAGE_KEY = "starMap.exchange";
const BURN_STORAGE_KEY = "starMap.burn";
const SHIP_STORAGE_KEY = "starMap.ship";
const MIN_DAYS_STORAGE_KEY = "starMap.minDays";
const DEFAULT_MIN_DAYS = 7;

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
    if (vCount > 1.5) {
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
  const [burnText, setBurnText] = useStoredText(BURN_STORAGE_KEY);
  const [shipId, setShipId] = useStoredText(SHIP_STORAGE_KEY, SHIP_SIZES[0].id);
  const [minDaysText, setMinDaysText] = useStoredText(MIN_DAYS_STORAGE_KEY, String(DEFAULT_MIN_DAYS));
  const [materialSizes, setMaterialSizes] = useState<Map<string, MaterialSize>>(() => new Map());
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

  const resolve = useMemo(() => (systems ? makeResolver(systems, planetNames) : null), [systems, planetNames]);

  const burn = useMemo(() => parseBurn(burnText, materialSizes), [burnText, materialSizes]);

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
    for (const entry of splitList(basesText)) {
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
  }, [resolve, basesText, burn]);

  const homeExchange = findExchange(exchangeCode);
  const empire = useMemo(
    () =>
      systems && bases.bySystem.size > 0
        ? computeEmpire(systems, [...bases.bySystem.keys()], (base) => bases.pinned.get(base) ?? homeExchange)
        : null,
    [systems, bases, homeExchange],
  );

  const ship = SHIP_SIZES.find((x) => x.id === shipId) ?? SHIP_SIZES[0];
  const minDays = Math.max(0, parseFloat(minDaysText) || 0);
  const plan = useMemo<PlannedRoute[]>(() => {
    if (!systems || !resolve || !empire || burn.bases.length === 0) return [];
    return planRoutes(systems, empire, loadsBySystem(burn.bases, resolve).loads, ship, minDays);
  }, [systems, resolve, empire, burn, ship, minDays]);
  useEffect(() => setSelectedRoute(null), [plan]);

  // A selected route narrows empire view to that one lap.
  const shownEmpire = useMemo<Empire | null>(() => {
    const route = selectedRoute === null ? undefined : plan[selectedRoute];
    if (!empire || !route) return empire;
    const stops = new Set(route.stops.map((s) => s.system));
    return { routes: empire.routes.filter((r) => stops.has(r.base)), systems: new Set(route.systems), edges: route.edges };
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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
        renderer.domElement.style.cursor = best >= 0 ? "pointer" : "grab";
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
        if (empire) {
          // Frame everything the empire view shows.
          const sphere = new THREE.Sphere().setFromPoints([...empire.systems].map((i) => new THREE.Vector3().fromArray(positions, i * 3)));
          flyTo(sphere.center, Math.max(FLY_DISTANCE, sphere.radius * 2.4));
        } else if (empireShown) {
          flyTo(new THREE.Vector3(), homeDistance);
        }
        empireShown = empire !== null;
        pick();
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
      if ((controls.update() || moved) && pointer && !dragging) pick();
      const distance = camera.position.distanceTo(controls.target) / homeDistance;
      const fade = THREE.MathUtils.clamp((LINK_FADE_START - distance) / (LINK_FADE_START - LINK_FADE_END), 0, 1);
      linkMaterial.opacity = fade * LINK_OPACITY;
      links.visible = fade > 0 && !empireShown;
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
      controls.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      linkGeometry.dispose();
      linkMaterial.dispose();
      routes.geometry.dispose();
      routeMaterial.dispose();
      baseMarkers.geometry.dispose();
      baseMaterial.dispose();
      dustGeometry.dispose();
      dustMaterial.dispose();
      renderer.dispose();
      el.remove();
    };
  }, [systems]);

  // These run after the scene effect above, so the handle is ready.
  // Empire view hides every other system, so hide their base rings too.
  useEffect(() => {
    const shown = [...bases.bySystem].filter(([i]) => !empireActive || shownEmpire?.systems.has(i));
    sceneApi.current?.setBases(new Map(shown.map(([i, labels]) => [i, labels.length])));
  }, [systems, bases, empireActive, shownEmpire]);

  useEffect(() => {
    sceneApi.current?.setEmpire(empireActive ? shownEmpire : null);
  }, [systems, shownEmpire, empireActive]);

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
        </div>
      )}

      <div style={{ ...panelStyle, right: 12, top: 12, width: 260, pointerEvents: "auto" }}>
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
          Your bases (planet names or IDs)
          <textarea
            value={basesText}
            onChange={(e) => updateBasesText(e.target.value)}
            rows={4}
            placeholder={"Montem, Katoa\nUV-351c\nMalahat > AI1"}
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
        <div style={{ color: "#6f80a3", fontSize: 11 }}>Pin one base with &quot;Base &gt; AI1&quot;.</div>
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
                {systems[r.base].name} → <span style={{ color: systems[r.exchange].exchange?.color }}>{systems[r.exchange].exchange?.code}</span>{" "}
                <span style={{ color: "#6f80a3" }}>
                  {r.jumps} jump{r.jumps === 1 ? "" : "s"}
                  {bases.pinned.has(r.base) && " (pinned)"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...panelStyle, left: 12, top: 12, width: plannerOpen ? 340 : undefined, maxHeight: "calc(100% - 210px)", overflowY: "auto", pointerEvents: "auto" }}>
        <button type="button" onClick={() => setPlannerOpen((open) => !open)} style={{ ...buttonStyle, width: plannerOpen ? "100%" : undefined }}>
          {plannerOpen ? "Hide route planner" : "Route planner"}
        </button>
        {plannerOpen && (
          <>
            <label style={{ display: "block", marginTop: 8, color: "#8fa3c7" }}>
              RPrUn burn table (XIT BURN, copied)
              <textarea
                value={burnText}
                onChange={(e) => setBurnText(e.target.value)}
                rows={3}
                placeholder={"Planet\tTicker\tInv\tBurn/day\tNeed\tDays\nMetis b\tDW\t58\t-56.5\t451\t1"}
                style={{ ...inputStyle, display: "block", width: "100%", marginTop: 4, resize: "vertical" }}
              />
            </label>
            <div style={{ color: "#6f80a3" }}>
              {burn.bases.length > 0 && `${burn.bases.length} bases with burn data; they are added to your bases.`}
              {burn.unknownTickers.length > 0 && <div style={{ color: "#ff8a80" }}>No size for: {burn.unknownTickers.join(", ")}</div>}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <label style={{ flex: 1, color: "#8fa3c7" }}>
                Ship hold
                <select value={ship.id} onChange={(e) => setShipId(e.target.value)} style={{ ...inputStyle, display: "block", width: "100%" }}>
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
            <div style={{ color: "#6f80a3", fontSize: 11, marginTop: 4 }}>
              Each hold leaves the exchange with every stop&apos;s inputs and picks up outputs on the way. Days = how long one hold supplies the
              route. No flight times, so laps are counted in jumps. Click a route to show it.
            </div>
            {burn.bases.length === 0 && <div style={{ marginTop: 6 }}>Paste a burn table to plan routes.</div>}
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
                      borderColor: selected ? BASE_COLOR : r.overloaded ? "rgba(255, 138, 128, 0.5)" : "rgba(160, 185, 255, 0.2)",
                    }}
                  >
                    <div>
                      <span style={{ color: exchange?.color }}>{exchange?.code}</span>{" "}
                      <span style={{ color: r.overloaded ? "#ff8a80" : BASE_COLOR }}>{r.coverDays.toFixed(1)} days</span>{" "}
                      <span style={{ color: "#6f80a3" }}>
                        ({r.binding}) · ~{r.lapJumps} jumps/lap
                      </span>
                    </div>
                    <div>{r.stops.map((stop) => `${systems[stop.system].name} (${stop.planets.join(", ")})`).join(" → ")}</div>
                    <div style={{ color: "#6f80a3" }}>
                      per day in {fmt(r.load.inT)}t / {fmt(r.load.inV)}m³ · out {fmt(r.load.outT)}t / {fmt(r.load.outV)}m³
                    </div>
                    {r.overloaded && <div style={{ color: "#ff8a80" }}>Under {minDays} days on its own: needs a bigger hold.</div>}
                  </button>
                );
              })}
          </>
        )}
      </div>

      <div style={{ ...panelStyle, left: 12, bottom: 12, pointerEvents: "none" }}>
        {EXCHANGES.map((x) => (
          <div key={x.code}>
            <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: x.color, boxShadow: `0 0 6px ${x.color}`, marginRight: 8 }} />
            {x.name} ({x.code})
          </div>
        ))}
        {baseCount > 0 && (
          <div>
            <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", border: `1px solid ${BASE_COLOR}`, marginRight: 8 }} />
            Your bases
          </div>
        )}
        <div style={{ color: "#6f80a3", marginTop: 4 }}>
          {systems ? `${systems.length} systems · ` : ""}drag rotate · right-drag pan · scroll zoom
        </div>
      </div>
    </div>
  );
}

const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));

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

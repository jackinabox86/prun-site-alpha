"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EXCHANGES, loadStarSystems, type StarSystem } from "@/lib/starMap";

// World-unit diameters. Neighbouring systems are ~50-100 units apart.
const STAR_SIZE = 30;
const EXCHANGE_SIZE = 90;
const MIN_POINT_PX = 5;
const HOVER_RADIUS_PX = 12;

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
  uniform float uScale;
  uniform float uMinPx;
  uniform int uHovered;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float s = size * (gl_VertexID == uHovered ? 1.8 : 1.0);
    gl_PointSize = clamp(s * uScale / -mv.z, uMinPx, 96.0);
    gl_Position = projectionMatrix * mv;
  }
`;

// A bright core with a soft falloff halo; additive blending makes it glow.
const fragmentShader = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(0.22, 0.0, d);
    float halo = pow(1.0 - d, 3.0) * 0.5;
    float a = (core + halo) * uOpacity;
    gl_FragColor = vec4(vColor * a, a);
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
  return out.set(s.x, s.z, -s.y);
}

interface HoverInfo {
  system: StarSystem;
  left: number;
  top: number;
}

export default function StarMapClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [systems, setSystems] = useState<StarSystem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadStarSystems()
      .then((s) => !cancelled && setSystems(s))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

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
    const starMaterial = makePointsMaterial(1);
    scene.add(new THREE.Points(starGeometry, starMaterial));

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
    const dustMaterial = makePointsMaterial(0.35);
    dustMaterial.uniforms.uMinPx.value = 1;
    scene.add(new THREE.Points(dustGeometry, dustMaterial));

    camera.position.set(0, radius * 0.55, radius * 0.45);
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
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

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
        setHover({ system: systems[best], left: pointer.x, top: pointer.y });
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

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      // Damping keeps the camera moving after a drag ends, so keep the
      // hovered star in sync with what is under the pointer.
      if (controls.update() && pointer && !dragging) pick();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerleave", onPointerLeave);
      controls.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      dustGeometry.dispose();
      dustMaterial.dispose();
      renderer.dispose();
      el.remove();
    };
  }, [systems]);

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

      {hover && (
        <div
          style={{
            position: "absolute",
            left: hover.left + 14,
            top: hover.top + 14,
            pointerEvents: "none",
            padding: "4px 8px",
            background: "rgba(6, 10, 24, 0.85)",
            border: `1px solid ${hover.system.exchange?.color ?? "rgba(160, 185, 255, 0.35)"}`,
            borderRadius: 3,
            color: "#e6edff",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            whiteSpace: "nowrap",
          }}
        >
          {hover.system.name}
          {hover.system.naturalId && hover.system.naturalId !== hover.system.name && (
            <span style={{ color: "#8fa3c7" }}> ({hover.system.naturalId})</span>
          )}
          {hover.system.exchange && (
            <div style={{ color: hover.system.exchange.color, fontSize: 11 }}>Commodity exchange {hover.system.exchange.code}</div>
          )}
        </div>
      )}

      <div
        style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          padding: "8px 10px",
          background: "rgba(6, 10, 24, 0.7)",
          border: "1px solid rgba(160, 185, 255, 0.2)",
          borderRadius: 3,
          color: "#b8c6e6",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          lineHeight: 1.6,
          pointerEvents: "none",
        }}
      >
        {EXCHANGES.map((x) => (
          <div key={x.code}>
            <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: x.color, boxShadow: `0 0 6px ${x.color}`, marginRight: 8 }} />
            {x.name} ({x.code})
          </div>
        ))}
        <div style={{ color: "#6f80a3", marginTop: 4 }}>
          {systems ? `${systems.length} systems · ` : ""}drag rotate · right-drag pan · scroll zoom
        </div>
      </div>
    </div>
  );
}

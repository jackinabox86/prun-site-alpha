// app/components/BestScenarioSankey.tsx
"use client";

import { useMemo } from "react";
import PlotlySankey from "./PlotlySankey";
import type { PriceMode } from "@/types";

// ---- API shapes (compatible with your report output) ----
type ApiMadeInputDetail = {
  ticker: string;
  amountNeeded: number;
  recipeId?: string | null;
  scenarioName?: string;
  details?: ApiMakeOption | null;     // present for MAKE
  // optional helpers from engine:
  unitCost?: number | null;           // BUY price
  totalCostPerBatch?: number | null;  // BUY: amount*unitCost; MAKE: cogm*amount
  childScenario?: string;             // MAKE child scenario label
};

type ApiMakeOption = {
  recipeId: string | null;
  ticker: string;
  scenario: string;
  runsPerDay: number;
  output1Amount: number;
  selfAreaPerDay: number | null;
  fullSelfAreaPerDay: number;
  baseProfitPerDay: number;
  profitPerDay: number;
  cogmPerOutput?: number | null;
  area: number;
  buildCost: number;
  inputBuffer7?: number | null;
  roiNarrowDays?: number | null;
  madeInputDetails?: ApiMadeInputDetail[];
};

export default function BestScenarioSankey({
  best,
  height = 520,         // MIN height
  priceMode,            // optional (only shown in hover)
}: {
  best: ApiMakeOption | null | undefined;
  height?: number;
  priceMode?: PriceMode;
}) {
  const result = useMemo(() => {
    if (!best) return null;

    // ----- visual tuning -----
    const ALPHA = 0.5;            // link width ∝ (cost/day)^ALPHA
    const THICK_PX = 20;          // node rectangle thickness in pixels (fixed)
    const GAP_PX = 10;            // vertical gap between nodes in same column
    const TOP_PAD_PX = 24;        // top margin inside plotting area
    const BOT_PAD_PX = 24;        // bottom margin
    const X_PAD = 0.06;           // normalized left/right padding
    const EXTRA_DRAG_BUFFER_PX = 120; // extra headroom

    const palette = {
      root:   "#2563eb",
      make:   "#3b82f6",
      buy:    "#f97316",
      border: "#0f172a",
      linkBuy:  "rgba(249,115,22,0.45)",
      linkMake: "rgba(59,130,246,0.45)",
    };

    // ---- node/link buffers ----
    const nodeIndexById = new Map<string, number>();
    const nodeLabels: string[] = [];
    const nodeColors: string[] = [];
    const nodeHover: string[] = [];

    const links = {
      source: [] as number[],
      target: [] as number[],
      value:  [] as number[],   // scaled width for plotly
      color:  [] as string[],
      hover:  [] as string[],
      label:  [] as string[],
      rawCostPerDay: [] as number[], // true metric (for hover if needed)
    };

    const fmt = (n: number) =>
      Number.isFinite(n) ? (Math.abs(n) >= 1000 ? n.toLocaleString() : n.toFixed(3)) : "n/a";
    const money = (n: number) =>
      Number.isFinite(n) ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "n/a";

    const ensureNode = (id: string, label: string, color: string, hover: string) => {
      if (nodeIndexById.has(id)) return nodeIndexById.get(id)!;
      const idx = nodeLabels.length;
      nodeIndexById.set(id, idx);
      nodeLabels.push(label);
      nodeColors.push(color);
      nodeHover.push(hover);
      return idx;
    };

    const addLink = (
      fromIdx: number,
      toIdx: number,
      label: string,
      costPerDay: number,   // true metric
      color: string,
      hover: string
    ) => {
      const v = Number.isFinite(costPerDay) && costPerDay > 0 ? Math.pow(costPerDay, ALPHA) : 0;
      if (!(v > 0)) return;
      links.source.push(fromIdx);
      links.target.push(toIdx);
      links.value.push(v);
      links.rawCostPerDay.push(costPerDay);
      links.color.push(color);
      links.hover.push(hover);
      links.label.push(label);
    };

    // Root node (the parent stage)
    const rootId = `STAGE::${best.recipeId || best.ticker}`;
    const rootHover = [
      `<b>${best.ticker}</b>`,
      best.scenario ? `Scenario: ${best.scenario}` : null,
      priceMode ? `Price mode: ${priceMode}` : null,
      `Runs/day: ${fmt(best.runsPerDay)}`,
      `Output1 amount: ${fmt(best.output1Amount)}`,
      `Base profit/day: ${money(best.baseProfitPerDay)}`,
      `Adj. profit/day: ${money(best.profitPerDay)}`,
      `Area/day (full): ${fmt(best.fullSelfAreaPerDay)}`,
      best.roiNarrowDays != null ? `ROI (narrow): ${fmt(best.roiNarrowDays)} days` : null,
      best.inputBuffer7 != null ? `Input buffer (7d): ${money(best.inputBuffer7)}` : null,
      `<i>Flow metric: Cost/day (width ∝ (cost/day)^${ALPHA})</i>`,
    ].filter(Boolean).join("<br/>");

    const rootIdx = ensureNode(rootId, best.ticker, palette.root, rootHover);

    // Recursive traversal (expands MAKE children; flow metric = Cost/day)
    const visited = new Set<string>();
    const MAX_DEPTH = 8;

    function traverse(stage: ApiMakeOption, stageIdx: number, stageRunsPerDay: number, depth: number) {
      if (!stage || depth > MAX_DEPTH) return;

      const stageKey = `VIS::${stage.recipeId || stage.ticker}::${depth}`;
      if (visited.has(stageKey)) return;
      visited.add(stageKey);

      const inputs = stage.madeInputDetails ?? [];
      for (const inp of inputs) {
        const amount = Number(inp.amountNeeded ?? 0);

        if (!inp.details) {
          // BUY: cost/day = totalCostPerBatch * stageRunsPerDay
          const batchCost = Number(inp.totalCostPerBatch ?? 0);
          const costPerDay = Math.max(0, batchCost * stageRunsPerDay);

          const buyNodeId = `BUY::${(stage.recipeId || stage.ticker)}::${inp.ticker}`;
          const buyHover = [
            `<b>Buy ${inp.ticker}</b>`,
            inp.unitCost != null ? `Unit price: ${money(inp.unitCost)}` : null,
            `Total cost/day: ${money(costPerDay)}`,
            `<i>Flow metric: Cost/day</i>`,
          ].filter(Boolean).join("<br/>");

          const buyIdx = ensureNode(buyNodeId, `Buy ${inp.ticker}`, palette.buy, buyHover);

          const linkHover = [
            `<b>${stage.ticker} → Buy ${inp.ticker}</b>`,
            `Cost/day: ${money(costPerDay)}`,
          ].join("<br/>");

          addLink(stageIdx, buyIdx, `Buy ${inp.ticker}`, costPerDay, palette.linkBuy, linkHover);
          continue;
        }

        // MAKE: cost/day = cogmPerOutput * amountNeeded * stageRunsPerDay
        const child = inp.details;
        const cogm  = Number(child.cogmPerOutput ?? 0);
        const costPerDay = Math.max(0, cogm * amount * stageRunsPerDay);

        const childId = `STAGE::${child.recipeId || child.ticker}`;
        const childHover = [
          `<b>Make ${child.recipeId || child.ticker}</b>`,
          inp.childScenario ? `Child scenario: ${inp.childScenario}` : null,
          `COGM/day: ${money(costPerDay)}`,
          `Base profit/day: ${money(child.baseProfitPerDay)}`,
          `Area/day (full): ${fmt(child.fullSelfAreaPerDay)}`,
          child.roiNarrowDays != null ? `ROI (narrow): ${fmt(child.roiNarrowDays)} days` : null,
          child.inputBuffer7 != null ? `Input buffer (7d): ${money(child.inputBuffer7)}` : null,
          `<i>Flow metric: Cost/day</i>`,
        ].filter(Boolean).join("<br/>");

        const childIdx = ensureNode(childId, `Make ${child.recipeId || child.ticker}`, palette.make, childHover);

        const linkHover = [
          `<b>${stage.ticker} → Make ${child.recipeId || child.ticker}</b>`,
          `COGM/day: ${money(costPerDay)}`,
        ].join("<br/>");

        addLink(stageIdx, childIdx, `Make ${child.recipeId || child.ticker}`, costPerDay, palette.linkMake, linkHover);

        // Recurse: child runs/day needed to satisfy parent's demand
        const childOut = Number(child.output1Amount || 0);
        const childRunsPerDayNeeded = childOut > 0 ? (amount * stageRunsPerDay) / childOut : 0;
        traverse(child, childIdx, childRunsPerDayNeeded, depth + 1);
      }
    }

    traverse(best, rootIdx, best.runsPerDay || 0, 0);

       // ---------- FREEFORM LAYOUT ----------
const N = nodeLabels.length;

// Build graph to compute levels (columns)
const indeg = new Array<number>(N).fill(0);
const adj: number[][] = Array.from({ length: N }, () => []);
for (let i = 0; i < links.source.length; i++) {
  const s = links.source[i], t = links.target[i];
  if (Number.isFinite(s) && Number.isFinite(t)) {
    adj[s].push(t);
    indeg[t] = (indeg[t] ?? 0) + 1;
  }
}

// BFS levels
const level = new Array<number>(N).fill(0);
const q: number[] = [];
for (let i = 0; i < N; i++) if (indeg[i] === 0) q.push(i);
while (q.length) {
  const u = q.shift()!;
  for (const v of adj[u]) {
    if (level[v] <= level[u]) level[v] = level[u] + 1;
    q.push(v);
  }
}

// Group nodes by column
const maxLevel = Math.max(0, ...level);
const cols: number[][] = Array.from({ length: maxLevel + 1 }, () => []);
for (let i = 0; i < N; i++) cols[level[i]].push(i);

// --- Dynamic height (in px) based on densest column ---
const densest = Math.max(1, ...cols.map(c => c.length));

const dynamicHeight = Math.max(
  height, // respect caller min
  Math.min(
    1800,
    Math.round(
      TOP_PAD_PX + BOT_PAD_PX + densest * (THICK_PX + GAP_PX) + EXTRA_DRAG_BUFFER_PX
    )
  )
);

// Convert pixel sizes to normalized units for y placement
const tn   = THICK_PX / dynamicHeight; // normalized node thickness
const gapN = GAP_PX   / dynamicHeight; // normalized gap
const topN = TOP_PAD_PX / dynamicHeight;
const botN = BOT_PAD_PX / dynamicHeight;
const EPS_N = 1 / dynamicHeight;       // ~1px jitter to avoid rounding collisions

// Horizontal x per column (kept away from edges)
const nodeX = new Array<number>(N).fill(0);
const left = X_PAD, right = 1 - X_PAD;
const step = (cols.length > 1) ? (right - left) / (cols.length - 1) : 0;
for (let c = 0; c < cols.length; c++) {
  const x = cols.length > 1 ? (left + c * step) : 0.5;
  for (const idx of cols[c]) nodeX[idx] = x;
}

// Sort nodes within each column for stable stacking:
//   1) Stage (MAKE) nodes first, BUY nodes after
//   2) Desc by total incoming cost/day (so big flows get more central space)
const inCost = new Array<number>(N).fill(0);
for (let i = 0; i < links.source.length; i++) {
  const t = links.target[i];
  const v = links.rawCostPerDay[i] ?? 0;
  if (Number.isFinite(t)) inCost[t] += v;
}
const isBuyNode = (idx: number) => (nodeLabels[idx] || "").startsWith("Buy ");

for (const column of cols) {
  column.sort((a, b) => {
    const aBuy = isBuyNode(a), bBuy = isBuyNode(b);
    if (aBuy !== bBuy) return aBuy ? 1 : -1;           // MAKE first
    const delta = (inCost[b] || 0) - (inCost[a] || 0);  // then by incoming cost/day
    if (delta !== 0) return delta;
    return a - b; // stable
  });
}

// Stack nodes by constant thickness + gap (center-based y for Plotly, clamped)
const nodeY = new Array<number>(N).fill(0);
for (const column of cols) {
  if (!column.length) continue;

  const avail = 1 - topN - botN;
  const totalNeeded = column.length * tn + (column.length - 1) * gapN;
  const startTop = topN + Math.max(0, (avail - totalNeeded)) / 2;

  let yTop = startTop;
  column.forEach((idx, i) => {
    // center y
    let yCenter = yTop + tn / 2 + i * EPS_N; // tiny jitter per row index
    // clamp to keep full node visible
    const half = tn / 2;
    if (yCenter < half) yCenter = half;
    if (yCenter > 1 - half) yCenter = 1 - half;
    nodeY[idx] = yCenter;

    yTop += tn + gapN;
  });
}

return {
  data: [
    {
      type: "sankey",
      arrangement: "freeform",
      uirevision: "keep",
      node: {
        pad: 0, // horizontal-only in freeform; vertical spacing is ours
        thickness: THICK_PX,
        line: { color: palette.border, width: 1 },
        label: nodeLabels,
        color: nodeColors,
        hovertemplate: "%{customdata}<extra></extra>",
        customdata: nodeHover,
        x: nodeX,
        y: nodeY, // center-based, non-overlapping, clamped
      },
      link: {
        source: links.source,
        target: links.target,
        value:  links.value,  // width values (scaled)
        color:  links.color,
        hovertemplate: "%{customdata}<extra></extra>",
        customdata: links.hover,
        label: links.label,
      },
    } as any,
  ],
  layout: {
    margin: { l: 12, r: 12, t: 24, b: 12 },
    font: { size: 12 },
    hovermode: "closest",
    height: dynamicHeight,
  },
};

  }, [best, priceMode, height]);

  if (!result || !best) return null;
  return (
    <PlotlySankey
      data={result.data}
      layout={result.layout}
    />
  );
}

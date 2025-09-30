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
  height = 520,         // acts as a MIN height now
  priceMode,            // optional, only shown in hover if passed
}: {
  best: ApiMakeOption | null | undefined;
  height?: number;
  priceMode?: PriceMode;
}) {
  const data = useMemo(() => {
    if (!best) return null;

    // ----- visual tuning -----
    const ALPHA = 0.5;          // width value = (cost/day)^ALPHA  (0.5 = sqrt)
    const X_PAD = 0.06;         // keep nodes away from left/right edges
    const Y_TOP_PAD = 0.04;     // normalized top padding
    const Y_BOTTOM_PAD = 0.04;  // normalized bottom padding
    const GAP_FRAC = 0.02;      // normalized gap between stacked nodes in a column

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
      value:  [] as number[],   // <-- width values fed to Plotly (scaled)
      color:  [] as string[],
      hover:  [] as string[],
      label:  [] as string[],
      trueCostPerDay: [] as number[], // keep true metric for layout + hover
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
      links.trueCostPerDay.push(costPerDay);
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

    // Recursive traversal (expands MAKE children, flow metric = Cost/day)
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

        // BUY edge: cost/day = totalCostPerBatch * stageRunsPerDay
        if (!inp.details) {
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

        // MAKE edge: cost/day = cogmPerOutput * amountNeeded * stageRunsPerDay
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

        // Recurse: how many runs/day does the child need to satisfy parent's demand?
        const childOut = Number(child.output1Amount || 0);
        const childRunsPerDayNeeded = childOut > 0 ? (amount * stageRunsPerDay) / childOut : 0;

        traverse(child, childIdx, childRunsPerDayNeeded, depth + 1);
      }
    }

    traverse(best, rootIdx, best.runsPerDay || 0, 0);

    // ---------- FREEFORM LAYOUT: compute x/y so nodes never overflow ----------
    const N = nodeLabels.length;
    const nodeX = new Array<number>(N).fill(0);
    const nodeY = new Array<number>(N).fill(0);

    // 1) Compute levels (columns) by BFS from roots (indegree 0)
    const indeg = new Array<number>(N).fill(0);
    const adj: number[][] = Array.from({ length: N }, () => []);
    for (let i = 0; i < links.source.length; i++) {
      const s = links.source[i], t = links.target[i];
      if (Number.isFinite(s) && Number.isFinite(t)) {
        adj[s].push(t);
        indeg[t] = (indeg[t] ?? 0) + 1;
      }
    }
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
    const maxLevel = Math.max(0, ...level);
    const cols: number[][] = Array.from({ length: maxLevel + 1 }, () => []);
    for (let i = 0; i < N; i++) cols[level[i]].push(i);

    // 2) Compute a "weight" per node = sum of incident width values (so column packing respects size)
    const inSum = new Array<number>(N).fill(0);
    const outSum = new Array<number>(N).fill(0);
    for (let i = 0; i < links.source.length; i++) {
      const s = links.source[i], t = links.target[i], v = links.value[i];
      outSum[s] += v;
      inSum[t]  += v;
    }
    const nodeWeight = new Array<number>(N).fill(0).map((_, i) => Math.max(inSum[i], outSum[i], 1e-6));

    // 3) Assign X per column with left/right padding
    const left = X_PAD, right = 1 - X_PAD;
    const step = (cols.length > 1) ? (right - left) / (cols.length - 1) : 0;
    for (let c = 0; c < cols.length; c++) {
      const x = cols.length > 1 ? (left + c * step) : 0.5;
      for (const idx of cols[c]) nodeX[idx] = x;
    }

    // 4) Pack each column vertically into [Y_TOP_PAD, 1-Y_BOTTOM_PAD]
    for (const col of cols) {
      if (!col.length) continue;

      // Sort by weight descending so tall nodes get placed first
      const sorted = [...col].sort((a, b) => nodeWeight[b] - nodeWeight[a]);

      const avail = 1 - Y_TOP_PAD - Y_BOTTOM_PAD;
      const totalWeight = sorted.reduce((s, i) => s + nodeWeight[i], 0);
      const totalGaps = GAP_FRAC * (sorted.length - 1);
      const scale = totalWeight > 0 ? Math.max(0, (avail - totalGaps)) / totalWeight : 0;

      let yCursor = Y_TOP_PAD;
      for (const idx of sorted) {
        nodeY[idx] = yCursor;
        yCursor += nodeWeight[idx] * scale + GAP_FRAC;
      }

      // Optional: center the stack if there's slack
      const used = yCursor - Y_TOP_PAD;
      const slack = avail - used;
      if (slack > 0) {
        for (const idx of sorted) nodeY[idx] += slack / 2;
      }
    }

    return {
      data: [
        {
          type: "sankey",
          arrangement: "freeform", // we provide x/y; users can drag anywhere
          uirevision: "keep",      // preserve positions on interactions
          node: {
            pad: 0, // we're managing gaps ourselves
            thickness: 20,
            line: { color: palette.border, width: 1 },
            label: nodeLabels,
            color: nodeColors,
            hovertemplate: "%{customdata}<extra></extra>",
            customdata: nodeHover,
            x: nodeX,
            y: nodeY,
          },
          link: {
            source: links.source,
            target: links.target,
            value: links.value,    // width values (scaled)
            color: links.color,
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
      },
    };
  }, [best, priceMode]);

  // ---------- Dynamic height calculation (stays as a MIN) ----------
  const dynamicHeight = useMemo(() => {
    if (!data) return height;
    const sankey = (data.data && data.data[0]) || ({} as any);
    const nodeThickness = sankey?.node?.thickness ?? 20;
    const nodePad = 8; // visual buffer (we control gaps ourselves)

    // estimate densest colum

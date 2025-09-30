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
    const ALPHA = 0.5;                 // link width ∝ (cost/day)^ALPHA
    const THICK_PX = 20;               // node rectangle thickness in pixels (fixed)
    const GAP_PX = 10;                 // vertical gap between nodes in same column (px)
    const TOP_PAD_PX = 24;             // top margin inside plotting area (px)
    const BOT_PAD_PX = 24;             // bottom margin (px)
    const X_PAD = 0.06;                // normalized left/right padding
    const EXTRA_DRAG_BUFFER_PX = 120;  // extra headroom (px)

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
    const nodeDepth: number[] = [];  // <— depth per node index

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

    // ensureNode now also records a depth
    const ensureNode = (
      id: string,
      label: string,
      color: string,
      hover: string,
      depth: number
    ) => {
      if (nodeIndexById.has(id)) return nodeIndexById.get(id)!;
      const idx = nodeLabels.length;
      nodeIndexById.set(id, idx);
      nodeLabels.push(label);
      nodeColors.push(color);
      nodeHover.push(hover);
      nodeDepth.push(depth);
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

    // Root node (the parent stage) at depth 0
    const rootId = `STAGE::${best.recipeId || best.ticker}::0`;
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

    const rootIdx = ensureNode(rootId, best.ticker, palette.root, rootHover, 0);

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

          const buyNodeId = `BUY::${stage.recipeId || stage.ticker}::${inp.ticker}::${depth + 1}`;
          const buyHover = [
            `<b>Buy ${inp.ticker}</b>`,
            inp.unitCost != null ? `Unit price: ${money(inp.unitCost)}` : null,
            `Total cost/day: ${money(costPerDay)}`,
            `<i>Flow metric: Cost/day</i>`,
          ].filter(Boolean).join("<br/>");

          const buyIdx = ensureNode(buyNodeId, `Buy ${inp.ticker}`, palette.buy, buyHover, depth + 1);

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

        const childId = `STAGE::${child.recipeId || child.ticker}::${depth + 1}`;
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

        const childIdx = ensureNode(
          childId,
          `Make ${child.recipeId || child.ticker}`,
          palette.make,
          childHover,
          depth + 1
        );

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

    // ---------- FREEFORM LAYOUT (explicit columns by recorded depth) ----------
    const N = nodeLabels.length;

    // Group nodes by the depth we recorded (stable)
    const maxDepth = Math.max(0, ...nodeDepth);
    const cols: number[][] = Array.from({ length: maxDepth + 1 }, () => []);
    for (let i = 0; i < N; i++) cols[nodeDepth[i]].push(i);

    // --- Dynamic height (in px) based on densest column ---
    const densest = Math.max(1, ...cols.map(c => c.length));

    const dynamicHeight = Math.max(
      height, // respect caller min
      Math.min(
        2000,
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
    const EPS_N = 1 / dynamicHeight;       // ~1px jitter to avoid exact-equality collisions

    // Horizontal x per depth column (kept away from edges)
    const nodeX = new Array<number>(N).fill(0);
    const left = X_PAD, right = 1 - X_PAD;
    const step = (cols.length > 1) ? (right - left) / (cols.length - 1) : 0;
    for (let c = 0; c < cols.length; c++) {
      const x = cols.length > 1 ? (left + c * step) : 0.5;
      for (const idx of cols[c]) nodeX[idx] = x;
    }

    // Sort within each column for stable stacking:
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

    // Stack nodes by constant thickness + gap using **TOP y** for Plotly
    const nodeY = new Array<number>(N).fill(0);
    for (const column of cols) {
      if (!column.length) continue;

      const avail = 1 - topN - botN;
      const totalNeeded = column.length * tn + (column.length - 1) * gapN;
      const startTop = topN + Math.max(0, (avail - totalNeeded)) / 2;

      column.forEach((idx, i) => {
        let yTop = startTop + i * (tn + gapN) + i * EPS_N; // TOP (not center)
        if (yTop < 0) yTop = 0;
        if (yTop > 1 - tn) yTop = 1 - tn;
        nodeY[idx] = yTop;
      });
    }

    return {
      data: [
        {
          type: "sankey",
          arrangement: "freeform",
          uirevision: "keep",
          node: {
            pad: 0, // vertical spacing is handled by us
            thickness: THICK_PX,
            line: { color: palette.border, width: 1 },
            label: nodeLabels,
            color: nodeColors,
            hovertemplate: "%{customdata}<extra></extra>",
            customdata: nodeHover,
            x: nodeX,
            y: nodeY, // TOP positions
          },
          link: {
            source: links.source,
            target: links.target,
            value:  links.value,  // width values (scaled)
            color:  links.color,
            hovertemplate: "%{customdata}<extra></extra>`,
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

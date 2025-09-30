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

    // 🔧 Non-linear width mapping (tunable)
    // width = (cost/day)^ALPHA   with 0<ALPHA<=1 (0.5 = sqrt)
    const ALPHA = 0.5;

    const palette = {
      root:   "#2563eb",
      make:   "#3b82f6",
      buy:    "#f97316",
      border: "#0f172a",
      linkBuy:  "rgba(249,115,22,0.45)",
      linkMake: "rgba(59,130,246,0.45)",
    };

    const nodeIndexById = new Map<string, number>();
    const nodeLabels: string[] = [];
    const nodeColors: string[] = [];
    const nodeHover: string[] = [];

    const links = {
      source: [] as number[],
      target: [] as number[],
      value:  [] as number[],  // <-- transformed width values
      color:  [] as string[],
      hover:  [] as string[],
      label:  [] as string[],
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
      widthValue: number, // transformed
      color: string,
      hover: string
    ) => {
      if (!(Number.isFinite(widthValue) && widthValue > 0)) return;
      links.source.push(fromIdx);
      links.target.push(toIdx);
      links.value.push(widthValue);
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
      `<i>Flow metric: Cost/day (rendered width ∝ (cost/day)^${ALPHA})</i>`,
    ].filter(Boolean).join("<br/>");

    const rootIdx = ensureNode(rootId, best.ticker, palette.root, rootHover);

    // Recursive traversal (expands MAKE children, flow = cost/day; width = cost^ALPHA)
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

        // BUY edge
        if (!inp.details) {
          const costPerDay = Number(inp.totalCostPerBatch ?? 0) * stageRunsPerDay; // true cost/day
          const widthValue = Math.pow(Math.max(0, costPerDay), ALPHA);

          const buyNodeId = `BUY::${(stage.recipeId || stage.ticker)}::${inp.ticker}`;
          const buyHover = [
            `<b>Buy ${inp.ticker}</b>`,
            inp.unitCost != null ? `Unit price: ${money(inp.unitCost)}` : null,
            `Cost/day: ${money(costPerDay)}`,
            `<i>Rendered width ∝ (cost/day)^${ALPHA}</i>`,
          ].filter(Boolean).join("<br/>");

          const buyIdx = ensureNode(buyNodeId, `Buy ${inp.ticker}`, palette.buy, buyHover);

          const linkHover = [
            `<b>${stage.ticker} → Buy ${inp.ticker}</b>`,
            `Cost/day: ${money(costPerDay)}`,
            `Width value: ${fmt(widthValue)}`,
          ].join("<br/>");

          addLink(stageIdx, buyIdx, `Buy ${inp.ticker}`, widthValue, palette.linkBuy, linkHover);
          continue;
        }

        // MAKE edge
        const child = inp.details;
        const cogm  = Number(child.cogmPerOutput ?? 0);
        const costPerDay = cogm * amount * stageRunsPerDay; // true cost/day
        const widthValue = Math.pow(Math.max(0, costPerDay), ALPHA);

        const childId = `STAGE::${child.recipeId || child.ticker}`;
        const childHover = [
          `<b>Make ${child.recipeId || child.ticker}</b>`,
          inp.childScenario ? `Child scenario: ${inp.childScenario}` : null,
          `COGM/day: ${money(costPerDay)}`,
          `Base profit/day: ${money(child.baseProfitPerDay)}`,
          `Area/day (full): ${fmt(child.fullSelfAreaPerDay)}`,
          child.roiNarrowDays != null ? `ROI (narrow): ${fmt(child.roiNarrowDays)} days` : null,
          child.inputBuffer7 != null ? `Input buffer (7d): ${money(child.inputBuffer7)}` : null,
          `<i>Rendered width ∝ (cost/day)^${ALPHA}</i>`,
        ].filter(Boolean).join("<br/>");

        const childIdx = ensureNode(childId, `Make ${child.recipeId || child.ticker}`, palette.make, childHover);

        const linkHover = [
          `<b>${stage.ticker} → Make ${child.recipeId || child.ticker}</b>`,
          `COGM/day: ${money(costPerDay)}`,
          `Width value: ${fmt(widthValue)}`,
        ].join("<br/>");

        addLink(stageIdx, childIdx, `Make ${child.recipeId || child.ticker}`, widthValue, palette.linkMake, linkHover);

        // Recurse: child runs/day to satisfy parent's *true* demand (not width-transformed)
        const childOut = Number(child.output1Amount || 0);
        const childRunsPerDayNeeded = childOut > 0 ? (amount * stageRunsPerDay) / childOut : 0;

        traverse(child, childIdx, childRunsPerDayNeeded, depth + 1);
      }
    }

    // Start from root at its own runs/day
    traverse(best, rootIdx, best.runsPerDay || 0, 0);

    // ---------- initial freeform positions so nodes don’t hug edges ----------
    const n = nodeLabels.length;
    const src: number[] = links.source;
    const tgt: number[] = links.target;

    const adj = Array.from({ length: n }, () => [] as number[]);
    const indeg = Array(n).fill(0);
    for (let i = 0; i < src.length; i++) {
      const s = src[i] ?? 0, t = tgt[i] ?? 0;
      adj[s].push(t);
      indeg[t] = (indeg[t] ?? 0) + 1;
    }

    const level = Array(n).fill(0);
    const q: number[] = [];
    for (let i = 0; i < n; i++) if (indeg[i] === 0) q.push(i);
    while (q.length) {
      const u = q.shift()!;
      for (const v of adj[u]) {
        if (level[v] <= level[u]) level[v] = level[u] + 1;
        q.push(v);
      }
    }

    const maxLevel = Math.max(0, ...level);
    const xPad = 0.07; // keep nodes away from hard edges
    const yPad = 0.06;

    // Count per level to vertically spread nodes
    const perLevel: Record<number, number[]> = {};
    for (let i = 0; i < n; i++) {
      const L = level[i] ?? 0;
      (perLevel[L] ||= []).push(i);
    }

    const nodeX = new Array(n).fill(0);
    const nodeY = new Array(n).fill(0);

    for (const [Lstr, indices] of Object.entries(perLevel)) {
      const L = Number(Lstr);
      const count = indices.length;
      const denom = Math.max(1, count - 1);
      indices.forEach((idx, k) => {
        // x evenly spaced by level (with padding)
        const x = maxLevel > 0
          ? xPad + (L / maxLevel) * (1 - 2 * xPad)
          : 0.5; // single level → center

        // y spread within this level
        const y = count === 1
          ? 0.5
          : yPad + (k / denom) * (1 - 2 * yPad);

        nodeX[idx] = x;
        nodeY[idx] = y;
      });
    }

    return {
      data: [
        {
          type: "sankey",
          arrangement: "freeform",  // draggable, not anchored to edges
          node: {
            pad: 20,
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
            value: links.value, // <-- transformed widths
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

  // ---------- Dynamic height calculation (unchanged) ----------
  const dynamicHeight = useMemo(() => {
    if (!data) return height;

    const sankey = (data.data && data.data[0]) || ({} as any);
    const nodeThickness = sankey?.node?.thickness ?? 20;
    const nodePad = sankey?.node?.pad ?? 8;

    const maxPerColumn = (() => {
      const n = sankey?.node?.label?.length ?? 0;
      if (!n) return 1;
      const src: number[] = sankey.link?.source ?? [];
      const tgt: number[] = sankey.link?.target ?? [];

      const adj = Array.from({ length: n }, () => [] as number[]);
      const indeg = Array(n).fill(0);
      for (let i = 0; i < src.length; i++) {
        const s = src[i] ?? 0;
        const t = tgt[i] ?? 0;
        adj[s]?.push(t);
        indeg[t] = (indeg[t] ?? 0) + 1;
      }

      const level = Array(n).fill(0);
      const q: number[] = [];
      for (let i = 0; i < n; i++) if (indeg[i] === 0) q.push(i);
      while (q.length) {
        const u = q.shift()!;
        for (const v of adj[u]) {
          if (level[v] <= level[u]) level[v] = level[u] + 1;
          q.push(v);
        }
      }

      const counts: Record<number, number> = {};
      for (const l of level) counts[l] = (counts[l] ?? 0) + 1;
      return Math.max(...Object.values(counts));
    })();

    const topBottomMargin = 120;
    const extraDragBuffer = 100;
    const estimated =
      topBottomMargin + maxPerColumn * (nodeThickness + nodePad) + extraDragBuffer;

    const MIN = Math.max(520, height);
    const MAX = 1600;
    return Math.max(MIN, Math.min(MAX, Math.round(estimated)));
  }, [data, height]);

  if (!best) return null;
  return <PlotlySankey data={data!.data} layout={{ ...data!.layout, height: dynamicHeight }} />;
}

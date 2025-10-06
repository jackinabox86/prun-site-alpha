// app/components/BestScenarioSankey.tsx
"use client";

import { useMemo, memo } from "react";
import PlotlySankey from "./PlotlySankey";
import type { PriceMode } from "@/types";
import { scenarioDisplayName } from "@/core/scenario";

// ---- API shapes (must match your report output) ----
type ApiMadeInputDetail = {
  ticker: string;
  amountNeeded: number;
  recipeId?: string | null;
  scenarioName?: string;
  details?: ApiMakeOption | null;
  unitCost?: number | null;
  totalCostPerBatch?: number | null;
  childScenario?: string;
  childRunsPerDayRequired?: number;
  childDemandUnitsPerDay?: number;
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
  totalProfitPA?: number;
  totalAreaPerDay?: number;
  totalInputBuffer7?: number | null;
  inputPaybackDays7Narrow?: number | null;
  inputPaybackDays7Broad?: number | null;
  madeInputDetails?: ApiMadeInputDetail[];
};

const BestScenarioSankey = memo(function BestScenarioSankey({
  best,
  height = 400,
  priceMode,
}: {
  best: ApiMakeOption | null | undefined;
  height?: number;
  priceMode?: PriceMode;
}) {
  const result = useMemo(() => {
    if (!best) return null;

    const ALPHA = 0.5;
    const THICK_PX = 20;
    const GAP_PX = 15;
    const TOP_PAD_PX = 24;
    const BOT_PAD_PX = 24;
    const X_PAD = 0.01;
    const EXTRA_DRAG_BUFFER_PX = 80;

    const palette = {
      root: "#2563eb",
      make: "#3b82f6",
      buy: "#f97316",
      border: "#0f172a",
      linkBuy: "rgba(249,115,22,0.45)",
      linkMake: "rgba(59,130,246,0.45)",
    };

    const nodeIndexById = new Map<string, number>();
    const nodeLabels: string[] = [];
    const nodeColors: string[] = [];
    const nodeHover: string[] = [];
    const nodeDepth: number[] = [];

    const links = {
      source: [] as number[],
      target: [] as number[],
      value: [] as number[],
      color: [] as string[],
      hover: [] as string[],
      label: [] as string[],
      rawCostPerDay: [] as number[],
    };

    const fmt = (n: number) =>
      Number.isFinite(n) ? (Math.abs(n) >= 1000 ? n.toLocaleString() : n.toFixed(3)) : "n/a";
    const money = (n: number) =>
      Number.isFinite(n) ? `₳${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "n/a";
    const fmtPA = (n: number) =>
      Number.isFinite(n) ? n.toFixed(1) : "n/a";
    const fmtWholeNumber = (n: number) =>
      Number.isFinite(n) ? Math.round(n).toLocaleString() : "n/a";
    const fmtROI = (n: number) =>
      Number.isFinite(n) ? n.toFixed(1).replace(/\.0$/, "") : "n/a";

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
      nodeDepth.push(Math.max(0, depth | 0));
      return idx;
    };

    const addLink = (
      fromIdx: number,
      toIdx: number,
      label: string,
      costPerDay: number,
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

    const rootId = `STAGE::${best.recipeId || best.ticker}::0`;
    const rootProfitPA = best.totalProfitPA ?? 0;
    const rootLabel = `<b>${best.ticker}</b><br>[₳${fmtPA(rootProfitPA)} P/A]`;
    const rootHover = [
      `<b>${best.ticker}</b>`,
      `Profit/d: ${fmtWholeNumber(best.baseProfitPerDay)}`,
      `Adj. Profit/d: ${fmtWholeNumber(best.profitPerDay)}`,
      `Area/day: ${fmtROI(best.totalAreaPerDay ?? best.fullSelfAreaPerDay)}`,
      best.roiNarrowDays != null ? `ROI (narrow): ${fmtROI(best.roiNarrowDays)} days` : null,
      best.inputBuffer7 != null ? `Input buffer 7d (narrow): ${money(best.inputBuffer7)}` : null,
      best.inputPaybackDays7Narrow != null ? `Input payback (narrow): ${fmtROI(best.inputPaybackDays7Narrow)} days` : null,
      best.totalInputBuffer7 != null ? `Input buffer 7d (broad): ${money(best.totalInputBuffer7)}` : null,
      best.inputPaybackDays7Broad != null ? `Input payback (broad): ${fmtROI(best.inputPaybackDays7Broad)} days` : null,
    ].filter(Boolean).join("<br>");
    const rootIdx = ensureNode(rootId, rootLabel, palette.root, rootHover, 0);

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
          const batchCost = Number(inp.totalCostPerBatch ?? 0);
          const costPerDay = Math.max(0, batchCost * stageRunsPerDay);

          const buyNodeId = `BUY::${stage.recipeId || stage.ticker}::${inp.ticker}::${depth + 1}`;
          const buyLabel = `<b>Buy ${inp.ticker}</b>`;
          const buyHover = [
            `<b>Buy ${inp.ticker}</b>`,
            inp.unitCost != null ? `Price: ${money(inp.unitCost)}` : null,
            `Cost/d: ${money(costPerDay)}`,
          ].filter(Boolean).join("<br>");

          const buyIdx = ensureNode(buyNodeId, buyLabel, palette.buy, buyHover, depth + 1);

          const linkHover = [
            `<b>${stage.ticker} ← Buy ${inp.ticker}</b>`,
            `Cost/d: ${money(costPerDay)}`,
          ].join("<br>");

          addLink(stageIdx, buyIdx, `Buy ${inp.ticker}`, costPerDay, palette.linkBuy, linkHover);
          continue;
        }

        const child = inp.details;
        const cogm = Number(child.cogmPerOutput ?? 0);
        const costPerDay = Math.max(0, cogm * amount * stageRunsPerDay);

        // Use pre-calculated values from engine if available, otherwise calculate
        const childRunsPerDayNeeded = inp.childRunsPerDayRequired ??
          (child.output1Amount > 0 ? (amount * stageRunsPerDay) / child.output1Amount : 0);
        const childDemandUnitsPerDay = inp.childDemandUnitsPerDay ?? (amount * stageRunsPerDay);

        const childId = `STAGE::${child.recipeId || child.ticker}::${depth + 1}`;
        const childProfitPA = child.totalProfitPA ?? 0;
        const childLabel = `<b>Make ${child.recipeId || child.ticker}</b><br>[₳${fmtPA(childProfitPA)} P/A]`;
        const childHover = [
          `<b>Make ${child.recipeId || child.ticker}</b>`,
          inp.childScenario ? `Scen: ${scenarioDisplayName(inp.childScenario)}` : null,
          `COGM/day: ${money(costPerDay)}`,
          `Base profit/day: ${money(child.baseProfitPerDay)}`,
          `Area/day: ${fmtROI(child.totalAreaPerDay ?? child.fullSelfAreaPerDay)}`,
          child.roiNarrowDays != null ? `ROI (narrow): ${fmtROI(child.roiNarrowDays)} days` : null,
          child.inputBuffer7 != null ? `Input buffer 7d (narrow): ${money(child.inputBuffer7)}` : null,
          child.inputPaybackDays7Narrow != null ? `Input payback (narrow): ${fmtROI(child.inputPaybackDays7Narrow)} days` : null,
          child.totalInputBuffer7 != null ? `Input buffer 7d (broad): ${money(child.totalInputBuffer7)}` : null,
          child.inputPaybackDays7Broad != null ? `Input payback (broad): ${fmtROI(child.inputPaybackDays7Broad)} days` : null,
          `Runs/day required: ${fmtROI(childRunsPerDayNeeded)} (of ${fmtROI(child.runsPerDay)})`,
          `Demand units/day: ${fmtROI(childDemandUnitsPerDay)}`,
        ].filter(Boolean).join("<br>");

        const childIdx = ensureNode(
          childId,
          childLabel,
          palette.make,
          childHover,
          depth + 1
        );

        const linkHover = [
          `<b>${stage.ticker} ← Make ${child.recipeId || child.ticker}</b>`,
          `COGM/d: ${money(costPerDay)}`,
        ].join("<br>");

        addLink(stageIdx, childIdx, `Make ${child.recipeId || child.ticker}`, costPerDay, palette.linkMake, linkHover);

        traverse(child, childIdx, childRunsPerDayNeeded, depth + 1);
      }
    }

    traverse(best, rootIdx, best.runsPerDay || 0, 0);

    const N = nodeLabels.length;

    const maxDepth = Math.max(0, ...nodeDepth);
    const cols: number[][] = Array.from({ length: maxDepth + 1 }, () => []);
    for (let i = 0; i < N; i++) cols[nodeDepth[i]].push(i);

    const inCost = new Array<number>(N).fill(0);
    const parentNode = new Array<number>(N).fill(-1);
    for (let i = 0; i < links.source.length; i++) {
      const s = links.source[i];
      const t = links.target[i];
      const v = links.rawCostPerDay[i] ?? 0;
      if (Number.isFinite(t)) {
        inCost[t] += v;
        // Record parent only if not set, or if this is a stronger connection
        if (parentNode[t] === -1 || (inCost[t] > 0 && v > inCost[t] * 0.5)) {
          parentNode[t] = s;
        }
      }
    }

    const isBuyNode = (idx: number) => (nodeLabels[idx] || "").startsWith("Buy ");
    
    // Calculate position of each node within its column for parent ordering
    const nodePositionInColumn = new Array<number>(N).fill(0);
    for (let d = 0; d <= maxDepth; d++) {
      cols[d].forEach((idx, pos) => {
        nodePositionInColumn[idx] = pos;
      });
    }

    for (const column of cols) {
      column.sort((a, b) => {
        // Priority 1: Group by parent's position in previous column
        const aParent = parentNode[a];
        const bParent = parentNode[b];
        if (aParent !== bParent && aParent !== -1 && bParent !== -1) {
          const aParentPos = nodePositionInColumn[aParent] ?? 0;
          const bParentPos = nodePositionInColumn[bParent] ?? 0;
          if (aParentPos !== bParentPos) return aParentPos - bParentPos;
        }
        
        // Priority 2: Within same parent, MAKE before BUY
        const aBuy = isBuyNode(a),
          bBuy = isBuyNode(b);
        if (aBuy !== bBuy) return aBuy ? 1 : -1;
        
        // Priority 3: Within same parent and type, sort by cost
        const delta = (inCost[b] || 0) - (inCost[a] || 0);
        if (delta !== 0) return delta;
        
        // Priority 4: Stable sort
        return a - b;
      });
      
      // Update positions after sorting this column
      column.forEach((idx, pos) => {
        nodePositionInColumn[idx] = pos;
      });
    }

    const densest = Math.max(1, ...cols.map((c) => c.length || 0));

    const spaceNeededForDensest = densest * THICK_PX + (densest - 1) * GAP_PX + densest * GAP_PX;

    const dynamicHeight = Math.max(
      height,
      Math.min(2200, Math.round(TOP_PAD_PX + BOT_PAD_PX + spaceNeededForDensest + EXTRA_DRAG_BUFFER_PX))
    );

    const tn = THICK_PX / dynamicHeight;
    const gapN = GAP_PX / dynamicHeight;
    const topN = TOP_PAD_PX / dynamicHeight;
    const botN = BOT_PAD_PX / dynamicHeight;

    const left = X_PAD,
      right = 1 - X_PAD;
    const totalSpan = Math.max(0.05, right - left);
    const step = maxDepth > 0 ? totalSpan / maxDepth : 0;

    const nodeX = new Array<number>(N).fill(0);
    const nodeY = new Array<number>(N).fill(0);

    for (let d = 0; d <= maxDepth; d++) {
      const column = cols[d];
      if (!column.length) continue;

      const x = maxDepth > 0 ? left + d * step : 0.5;

      let currentY = topN;

      column.forEach((idx, i) => {
        nodeX[idx] = x;
        nodeY[idx] = currentY;

        currentY += tn + gapN;
      });
    }

    return {
      data: [
        {
          type: "sankey",
          arrangement: "snap",
          uirevision: "keep",
          node: {
            pad: GAP_PX,
            thickness: THICK_PX,
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
            value: links.value,
            color: links.color,
            hovertemplate: "%{customdata}<extra></extra>",
            customdata: links.hover,
            label: links.label,
          },
          textfont: { size: 13 },
        } as any,
      ],
      layout: {
        margin: { l: 2, r: 2, t: 24, b: 12 },
        font: {
          size: 12,
          family: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
        },
        hovermode: "closest",
        height: dynamicHeight,
      },
    };
  }, [best, priceMode, height]);

  if (!result || !best) return null;
  return <PlotlySankey data={result.data} layout={result.layout} />;
});

export default BestScenarioSankey;

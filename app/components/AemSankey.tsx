// app/components/AemSankey.tsx
"use client";

import { useMemo, memo } from "react";
import PlotlySankey from "./PlotlySankey";
import type { ChainNode } from "@/core/aemChainBuilder";

const AemSankey = memo(function AemSankey({
  chain,
  height = 400,
}: {
  chain: ChainNode | null;
  height?: number;
}) {
  const result = useMemo(() => {
    if (!chain) return null;

    const THICK_PX = 20;
    const GAP_PX = 15;
    const TOP_PAD_PX = 24;
    const BOT_PAD_PX = 24;
    const X_PAD = 0.01;
    const EXTRA_DRAG_BUFFER_PX = 80;
    const EQUAL_LINK_VALUE = 1; // All links have equal width

    const palette = {
      root: "#ff9500",       // Orange for root
      make: "#ff7a00",       // Darker orange for MAKE nodes
      error: "#ff4444",      // Red for error nodes
      border: "#0f172a",
      link: "rgba(255,149,0,0.45)",
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
    };

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
      color: string,
      hover: string
    ) => {
      links.source.push(fromIdx);
      links.target.push(toIdx);
      links.value.push(EQUAL_LINK_VALUE); // Equal width for all links
      links.color.push(color);
      links.hover.push(hover);
      links.label.push(label);
    };

    // Helper to check if recipe ID differs from ticker (e.g., "C_5" vs "C")
    const recipeIdDiffersFromTicker = (ticker: string, recipeId: string | null): boolean => {
      if (!recipeId) return false;
      // Recipe IDs are format TICKER_N, so check if it's not just the ticker
      const baseTicker = recipeId.split("_")[0];
      return baseTicker === ticker && recipeId !== ticker;
    };

    // Create root node
    const showRootRecipeId = recipeIdDiffersFromTicker(chain.ticker, chain.recipeId);
    const rootLabel = chain.isError
      ? `<b>&nbsp;${chain.ticker}</b><br>[ERROR]`
      : showRootRecipeId
        ? `<b>&nbsp;${chain.ticker}</b><br>[${chain.recipeId}]`
        : `<b>&nbsp;${chain.ticker}</b>`;

    const rootHover = chain.isError
      ? [`<b>${chain.ticker}</b>`, `Error: ${chain.errorMessage}`].join("<br>")
      : [
          `<b>${chain.ticker}</b>`,
          chain.building ? `Building: ${chain.building}` : null,
        ]
          .filter(Boolean)
          .join("<br>");

    const rootColor = chain.isError ? palette.error : palette.root;
    const rootIdx = ensureNode(chain.id, rootLabel, rootColor, rootHover, 0);

    const visited = new Set<string>();

    function traverse(node: ChainNode, nodeIdx: number, depth: number) {
      if (!node || depth > 8) return;

      const nodeKey = `${node.id}`;
      if (visited.has(nodeKey)) return;
      visited.add(nodeKey);

      for (const input of node.inputs) {
        const child = input.childNode;
        if (!child) continue;

        const childId = `${child.ticker}::${depth + 1}::${visited.size}`;
        const isError = child.isError;

        const showChildRecipeId = recipeIdDiffersFromTicker(child.ticker, child.recipeId);
        const isRawMaterial = isError && child.errorMessage?.includes("raw");
        const childLabel = isError
          ? isRawMaterial
            ? `<b>&nbsp;${child.ticker}</b>`
            : `<b>&nbsp;${child.ticker}</b><br>[ERROR]`
          : showChildRecipeId
            ? `<b>&nbsp;${child.ticker}</b><br>[${child.recipeId}]`
            : `<b>&nbsp;${child.ticker}</b>`;

        const childHover = isError
          ? isRawMaterial
            ? [`<b>${child.ticker}</b>`, `Amount needed: ${input.amount}`].join("<br>")
            : [`<b>${child.ticker}</b>`, `${child.errorMessage}`].join("<br>")
          : [
              `<b>${child.ticker}</b>`,
              child.building ? `Building: ${child.building}` : null,
              `Amount needed: ${input.amount}`,
            ]
              .filter(Boolean)
              .join("<br>");

        const childColor = isError ? palette.error : palette.make;
        const childIdx = ensureNode(childId, childLabel, childColor, childHover, depth + 1);

        const linkHover = [
          `<b>${node.ticker} ← ${child.ticker}</b>`,
          `Amount: ${input.amount}`,
        ].join("<br>");

        addLink(nodeIdx, childIdx, `${child.ticker}`, palette.link, linkHover);

        // Recursively traverse children (only if not an error node)
        if (!isError) {
          traverse(child, childIdx, depth + 1);
        }
      }
    }

    traverse(chain, rootIdx, 0);

    const N = nodeLabels.length;
    if (N === 0) return null;

    const maxDepth = Math.max(0, ...nodeDepth);
    const cols: number[][] = Array.from({ length: maxDepth + 1 }, () => []);
    for (let i = 0; i < N; i++) cols[nodeDepth[i]].push(i);

    // Sort columns: group by parent position
    const parentNode = new Array<number>(N).fill(-1);
    for (let i = 0; i < links.source.length; i++) {
      const s = links.source[i];
      const t = links.target[i];
      if (parentNode[t] === -1) {
        parentNode[t] = s;
      }
    }

    const nodePositionInColumn = new Array<number>(N).fill(0);
    for (let d = 0; d <= maxDepth; d++) {
      cols[d].forEach((idx, pos) => {
        nodePositionInColumn[idx] = pos;
      });
    }

    for (const column of cols) {
      column.sort((a, b) => {
        const aParent = parentNode[a];
        const bParent = parentNode[b];
        if (aParent !== bParent && aParent !== -1 && bParent !== -1) {
          const aParentPos = nodePositionInColumn[aParent] ?? 0;
          const bParentPos = nodePositionInColumn[bParent] ?? 0;
          if (aParentPos !== bParentPos) return aParentPos - bParentPos;
        }
        return a - b;
      });

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

      column.forEach((idx) => {
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
          family: "'Courier New', 'Consolas', 'Monaco', monospace",
          color: "white",
        },
        hoverlabel: {
          font: {
            family: "'Courier New', 'Consolas', 'Monaco', monospace",
            size: 13,
            color: "white",
          },
          bgcolor: "#101419",
          bordercolor: "#ff9500",
        },
        plot_bgcolor: "#0a0e14",
        paper_bgcolor: "#0a0e14",
        hovermode: "closest",
        height: dynamicHeight,
      },
    };
  }, [chain, height]);

  if (!result || !chain) return null;
  return <PlotlySankey data={result.data} layout={result.layout} />;
});

export default AemSankey;

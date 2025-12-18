// app/components/AemSankey.tsx
"use client";

import { useMemo, memo, useState, useEffect } from "react";
import PlotlySankey from "./PlotlySankey";
import type { ChainNode } from "@/core/aemChainBuilder";

const MAX_DEPTH = 20;

interface AemSankeyProps {
  chain: ChainNode | null;
  height?: number;
}

const AemSankey = memo(function AemSankey({ chain, height = 400 }: AemSankeyProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [windowHeight, setWindowHeight] = useState(800);

  // Track window size for expanded view
  useEffect(() => {
    const updateHeight = () => setWindowHeight(window.innerHeight);
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  // Handle escape key to close expanded view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isExpanded) {
        setIsExpanded(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded]);

  // Prevent body scroll when expanded
  useEffect(() => {
    if (isExpanded) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isExpanded]);

  const result = useMemo(() => {
    if (!chain) return null;

    const THICK_PX = 20;
    const GAP_PX = 15;
    const TOP_PAD_PX = 24;
    const BOT_PAD_PX = 24;
    const X_PAD = 0.01;
    const EXTRA_DRAG_BUFFER_PX = 80;
    const EQUAL_LINK_VALUE = 1;

    const palette = {
      root: "#ff9500",
      make: "#ff7a00",
      error: "#ff4444",
      border: "#0f172a",
      link: "rgba(255,149,0,0.45)",
    };

    // Helper to check if recipe ID differs from ticker
    const recipeIdDiffersFromTicker = (ticker: string, recipeId: string | null): boolean => {
      if (!recipeId) return false;
      const baseTicker = recipeId.split("_")[0];
      return baseTicker === ticker && recipeId !== ticker;
    };

    // Phase 1: Collect all unique tickers and find their deepest depth
    // Also collect all parent-child relationships with amounts
    interface TickerInfo {
      ticker: string;
      recipeId: string | null;
      building: string | null;
      isError: boolean;
      isRawMaterial: boolean;
      errorMessage?: string;
      maxDepth: number;
      parents: Map<string, number>; // parentTicker -> amount needed
    }

    const tickerMap = new Map<string, TickerInfo>();
    const linkSet = new Set<string>(); // "parent::child" to avoid duplicate links

    function collectTickers(node: ChainNode, depth: number, parentTicker: string | null, amountNeeded: number) {
      if (!node || depth > MAX_DEPTH) return;

      const ticker = node.ticker;
      const isError = !!node.isError;
      const isRawMaterial = isError && !!node.errorMessage?.includes("raw");

      // Get or create ticker info
      let info = tickerMap.get(ticker);
      if (!info) {
        info = {
          ticker,
          recipeId: node.recipeId,
          building: node.building,
          isError,
          isRawMaterial,
          errorMessage: node.errorMessage,
          maxDepth: depth,
          parents: new Map(),
        };
        tickerMap.set(ticker, info);
      } else {
        // Update max depth if this occurrence is deeper
        if (depth > info.maxDepth) {
          info.maxDepth = depth;
        }
      }

      // Record parent relationship
      if (parentTicker) {
        const existingAmount = info.parents.get(parentTicker) || 0;
        info.parents.set(parentTicker, existingAmount + amountNeeded);
      }

      // Recurse into children (only if not an error node)
      if (!isError) {
        for (const input of node.inputs) {
          if (input.childNode) {
            collectTickers(input.childNode, depth + 1, ticker, input.amount);
          }
        }
      }
    }

    collectTickers(chain, 0, null, 0);

    // Phase 2: Build Sankey data with deduplicated nodes at their deepest level
    const nodeIndexByTicker = new Map<string, number>();
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

    // Create nodes for all tickers
    for (const [ticker, info] of tickerMap) {
      const idx = nodeLabels.length;
      nodeIndexByTicker.set(ticker, idx);

      const showRecipeId = recipeIdDiffersFromTicker(ticker, info.recipeId);
      const isRoot = ticker === chain.ticker;

      let label: string;
      if (info.isError) {
        label = info.isRawMaterial
          ? `<b>&nbsp;${ticker}</b>`
          : `<b>&nbsp;${ticker}</b><br>[ERROR]`;
      } else if (showRecipeId) {
        label = `<b>&nbsp;${ticker}</b><br>[${info.recipeId}]`;
      } else {
        label = `<b>&nbsp;${ticker}</b>`;
      }

      let hover: string;
      if (info.isError) {
        hover = info.isRawMaterial
          ? `<b>${ticker}</b>`
          : [`<b>${ticker}</b>`, `${info.errorMessage}`].join("<br>");
      } else {
        hover = [
          `<b>${ticker}</b>`,
          info.building ? `Building: ${info.building}` : null,
        ]
          .filter(Boolean)
          .join("<br>");
      }

      const color = info.isError ? palette.error : isRoot ? palette.root : palette.make;

      nodeLabels.push(label);
      nodeColors.push(color);
      nodeHover.push(hover);
      nodeDepth.push(info.maxDepth);
    }

    // Create links (from child at deeper level to parent at shallower level)
    for (const [ticker, info] of tickerMap) {
      const childIdx = nodeIndexByTicker.get(ticker);
      if (childIdx === undefined) continue;

      for (const [parentTicker, amount] of info.parents) {
        const parentIdx = nodeIndexByTicker.get(parentTicker);
        if (parentIdx === undefined) continue;

        const linkKey = `${parentTicker}::${ticker}`;
        if (linkSet.has(linkKey)) continue;
        linkSet.add(linkKey);

        // Link goes from parent (source, shallower) to child (target, deeper)
        // But since child is at deeper level (right side), we want flow to go left
        // Sankey flows from source to target, so source=child, target=parent for left flow
        links.source.push(childIdx);
        links.target.push(parentIdx);
        links.value.push(EQUAL_LINK_VALUE);
        links.color.push(palette.link);
        links.hover.push([`<b>${parentTicker} ← ${ticker}</b>`, `Amount: ${amount}`].join("<br>"));
        links.label.push(ticker);
      }
    }

    const N = nodeLabels.length;
    if (N === 0) return null;

    // Find actual max depth used
    const maxDepth = Math.max(0, ...nodeDepth);

    // Group nodes by depth
    const cols: number[][] = Array.from({ length: maxDepth + 1 }, () => []);
    for (let i = 0; i < N; i++) {
      cols[nodeDepth[i]].push(i);
    }

    // Sort columns alphabetically by ticker for consistency
    for (const column of cols) {
      column.sort((a, b) => {
        const tickerA = nodeLabels[a].replace(/<[^>]*>/g, "").trim();
        const tickerB = nodeLabels[b].replace(/<[^>]*>/g, "").trim();
        return tickerA.localeCompare(tickerB);
      });
    }

    const densest = Math.max(1, ...cols.map((c) => c.length || 0));
    const spaceNeededForDensest = densest * THICK_PX + (densest - 1) * GAP_PX + densest * GAP_PX;

    const dynamicHeight = Math.max(
      height,
      Math.min(4000, Math.round(TOP_PAD_PX + BOT_PAD_PX + spaceNeededForDensest + EXTRA_DRAG_BUFFER_PX))
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
      dynamicHeight,
    };
  }, [chain, height]);

  if (!result || !chain) return null;

  const expandedHeight = windowHeight - 80;

  // Normal inline view
  const normalView = (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setIsExpanded(true)}
        className="terminal-button"
        style={{
          position: "absolute",
          top: "0.5rem",
          right: "0.5rem",
          zIndex: 100,
          padding: "0.5rem 1rem",
          fontSize: "0.75rem",
        }}
      >
        Fullscreen
      </button>
      <PlotlySankey data={result.data} layout={result.layout} />
    </div>
  );

  // Expanded overlay view
  const expandedView = (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "#0a0e14",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--color-border-primary)",
          backgroundColor: "#0a0e14",
        }}
      >
        <span style={{ color: "var(--color-accent-primary)", fontFamily: "var(--font-mono)", fontSize: "0.875rem" }}>
          Production Chain: {chain.ticker}
        </span>
        <button
          onClick={() => setIsExpanded(false)}
          className="terminal-button"
          style={{ padding: "0.5rem 1rem", fontSize: "0.75rem" }}
        >
          Close (Esc)
        </button>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "0.5rem" }}>
        <PlotlySankey
          data={result.data}
          layout={{
            ...result.layout,
            height: expandedHeight,
          }}
        />
      </div>
    </div>
  );

  return (
    <>
      {normalView}
      {isExpanded && expandedView}
    </>
  );
});

export default AemSankey;

// app/components/BestScenarioSankey.tsx
"use client";

import { useMemo } from "react";
import PlotlySankey from "./PlotlySankey";

type ApiMadeInputDetail = {
  source?: "BUY" | "MAKE";
  ticker: string;
  amountNeeded: number;
  recipeId?: string | null;
  scenarioName?: string;
  details?: ApiMakeOption | null;

  // from engine.ts (already present)
  unitCost?: number | null;            // ask/derived
  totalCostPerBatch?: number | null;   // amountNeeded * unitCost (BUY) or cogmPerOutput * amountNeeded (MAKE)
  childScenario?: string;
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
  height = 520,
}: {
  best: ApiMakeOption | null | undefined;
  height?: number;
}) {
  const data = useMemo(() => {
    if (!best) return null;

    const palette = {
      root: "#2563eb",
      make: "#3b82f6",
      buy:  "#f97316",
      border: "#0f172a",
    };

    const nodeIndexById = new Map<string, number>();
    const nodeLabels: string[] = [];
    const nodeColors: string[] = [];
    const nodeHover: string[] = [];

    const links = {
      source: [] as number[],
      target: [] as number[],
      value:  [] as number[],
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

    // root node
    const rootId = `ROOT::${best.ticker}`;
    const rootHover = [
      `<b>${best.ticker}</b>`,
      best.scenario ? `Scenario: ${best.scenario}` : null,
      `Runs/day: ${fmt(best.runsPerDay)}`,
      `Output1 amount: ${fmt(best.output1Amount)}`,
      `Base profit/day: ${money(best.baseProfitPerDay)}`,
      `Adj. profit/day: ${money(best.profitPerDay)}`,
      `Area/day (full): ${fmt(best.fullSelfAreaPerDay)}`,
      best.roiNarrowDays != null ? `ROI (narrow): ${fmt(best.roiNarrowDays)} days` : null,
      best.inputBuffer7 != null ? `Input buffer (7d): ${money(best.inputBuffer7)}` : null,
      `<i>Flow metric: Cost/day</i>`,
    ].filter(Boolean).join("<br/>");

    const rootIdx = ensureNode(rootId, `${best.ticker}`, palette.root, rootHover);

    // parent runs/day used to scale input costs per day
    const parentRunsPerDay = best.runsPerDay || 0;

    const addLink = (from: number, to: number, label: string, v: number, color: string, hover: string) => {
      if (!(Number.isFinite(v) && v > 0)) return;
      links.source.push(from);
      links.target.push(to);
      links.value.push(v);
      links.color.push(color);
      links.hover.push(hover);
      links.label.push(label);
    };

    // expand inputs as Cost/day
    const details = best.madeInputDetails ?? [];
    for (const d of details) {
      const amount = Number(d.amountNeeded ?? 0);

      if (d.source === "BUY" || !d.details) {
        // BUY: cost/day = (amount * unitCost) * parent runs/day
        const totalCostPerBatch = Number(d.totalCostPerBatch ?? 0);
        const costPerDay = totalCostPerBatch * parentRunsPerDay;

        const buyId = `BUY::${best.ticker}::${d.ticker}`;
        const buyHover = [
          `<b>Buy ${d.ticker}</b>`,
          d.unitCost != null ? `Unit price: ${money(d.unitCost)}` : null,
          `Total cost/day: ${money(costPerDay)}`,
          `<i>Flow metric: Cost/day</i>`,
        ].filter(Boolean).join("<br/>");

        const buyIdx = ensureNode(buyId, `Buy ${d.ticker}`, palette.buy, buyHover);
        const linkHover = [
          `<b>${best.ticker} → Buy ${d.ticker}</b>`,
          `Cost/day: ${money(costPerDay)}`,
        ].join("<br/>");

        addLink(rootIdx, buyIdx, `Buy ${d.ticker}`, costPerDay, "rgba(249,115,22,0.45)", linkHover);
        continue;
      }

      // MAKE: cost/day = cogmPerOutput * amountNeeded * parent runs/day
      const child = d.details;
      const cogm = Number(child.cogmPerOutput ?? 0);
      const costPerDay = cogm * amount * parentRunsPerDay;

      const makeId = `MAKE::${best.ticker}::${child.recipeId || child.ticker}`;
      const makeHover = [
        `<b>Make ${child.recipeId || child.ticker}</b>`,
        d.childScenario ? `Child scenario: ${d.childScenario}` : null,
        `COGM/day: ${money(costPerDay)}`,
        `Base profit/day: ${money(child.baseProfitPerDay)}`,
        `Area/day (full): ${fmt(child.fullSelfAreaPerDay)}`,
        child.roiNarrowDays != null ? `ROI (narrow): ${fmt(child.roiNarrowDays)} days` : null,
        child.inputBuffer7 != null ? `Input buffer (7d): ${money(child.inputBuffer7)}` : null,
        `<i>Flow metric: Cost/day</i>`,
      ].filter(Boolean).join("<br/>");

      const makeIdx = ensureNode(makeId, `Make ${child.recipeId || child.ticker}`, palette.make, makeHover);

      const linkHover = [
        `<b>${best.ticker} → Make ${child.recipeId || child.ticker}</b>`,
        `COGM/day: ${money(costPerDay)}`,
      ].join("<br/>");

      addLink(rootIdx, makeIdx, `Make ${child.recipeId || child.ticker}`, costPerDay, "rgba(59,130,246,0.45)", linkHover);
    }

    return {
      data: [
        {
          type: "sankey",
          arrangement: "snap",
          node: {
            pad: 20,
            thickness: 20,
            line: { color: palette.border, width: 1 },
            label: nodeLabels,
            color: nodeColors,
            hovertemplate: "%{customdata}<extra></extra>",
            customdata: nodeHover,
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
        } as any,
      ],
      layout: {
        margin: { l: 12, r: 12, t: 24, b: 12 },
        font: { size: 12 },
        hovermode: "closest",
      },
    };
  }, [best]); // no toggle → only depends on best

  if (!best) return null;
  return <PlotlySankey data={data!.data} layout={data!.layout} height={height} />;
}

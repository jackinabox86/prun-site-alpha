"use client";

import { useMemo } from "react";
import PlotlySankey from "./PlotlySankey";
import type { MakeOption, MadeInputDetail, PriceMode } from "@/types";

type ApiMadeInputDetail = Omit<MadeInputDetail, "details"> & {
  details: ApiMakeOption | null;
};

type ApiMakeOption = Omit<MakeOption, "madeInputDetails"> & {
  madeInputDetails: ApiMadeInputDetail[];
  roiNarrowDays?: number | null;
  inputPaybackDays7?: number | null;
  totalAreaPerDay?: number | null;
  totalProfitPA?: number | null;
};

type BestScenario = ApiMakeOption & {
  rows?: [string, number | string][];
};

type Props = {
  best: BestScenario;
  ticker: string;
  priceMode: PriceMode;
};

const palette = {
  root: "#2563eb",
  buy: "#f97316",
  make: ["#0ea5e9", "#14b8a6", "#22d3ee", "#10b981"],
};

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCurrency(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function makeHover(lines: Array<string | null | undefined>) {
  return lines.filter(Boolean).join("<br>");
}

interface StageMetrics {
  runsRequired: number;
  demandUnitsPerDay: number;
  stageProfitPerDay: number;
  adjStageProfitPerDay: number;
  selfAreaPerDay: number;
  fullAreaCapacity: number;
  totalProfitPA: number | null | undefined;
  valuePerDay: number;
}

interface TraverseContext {
  nodeId: string;
  path: string[];
  demandUnitsPerDay: number;
  depth: number;
  parentTicker?: string;
}

interface TraverseResult {
  nodeIndex: number;
  metrics: StageMetrics;
}

export default function BestScenarioSankey({ best, ticker, priceMode }: Props) {
  const chart = useMemo(() => {
    if (!best) return null;

    const nodeLabels: string[] = [];
    const nodeHoverTemplates: string[] = [];
    const nodeColors: string[] = [];
    const nodeCustomData: any[] = [];

    const linkSources: number[] = [];
    const linkTargets: number[] = [];
    const linkValues: number[] = [];
    const linkLabels: string[] = [];
    const linkHoverTemplates: string[] = [];
    const linkColors: string[] = [];

    const nodeIndexMap = new Map<string, number>();

    const getMakeColor = (depth: number) => {
      if (depth === 0) return palette.root;
      const idx = (depth - 1) % palette.make.length;
      return palette.make[idx];
    };

    const ensureNode = (
      id: string,
      builder: () => {
        label: string;
        hover: string;
        color: string;
        customdata?: any;
      }
    ) => {
      if (nodeIndexMap.has(id)) return nodeIndexMap.get(id)!;
      const built = builder();
      nodeLabels.push(built.label);
      nodeHoverTemplates.push(`${built.hover}<extra></extra>`);
      nodeColors.push(built.color);
      nodeCustomData.push(built.customdata ?? null);
      const index = nodeLabels.length - 1;
      nodeIndexMap.set(id, index);
      return index;
    };

    const pushLink = (
      source: number,
      target: number,
      value: number,
      label: string,
      hover: string,
      color: string
    ) => {
      if (!Number.isFinite(value) || value <= 0) return;
      linkSources.push(source);
      linkTargets.push(target);
      linkValues.push(value);
      linkLabels.push(label);
      linkHoverTemplates.push(`${hover}<extra></extra>`);
      linkColors.push(color);
    };

    const computeMetrics = (option: ApiMakeOption, demandUnitsPerDay: number): StageMetrics => {
      const outputPerRun = option.output1Amount || 0;
      const runsRequired = outputPerRun > 0 ? demandUnitsPerDay / outputPerRun : 0;
      const stageProfitPerDay = (option.baseProfit || 0) * runsRequired;
      const adjStageProfitPerDay = (option.profit || 0) * runsRequired;
      const valuePerDay = (option.valuePerOutput || 0) * demandUnitsPerDay;
      const perOutputArea = option.selfAreaPerDay ?? 0;
      const selfAreaPerDay = perOutputArea * demandUnitsPerDay;
      const fullAreaCapacity = option.fullSelfAreaPerDay ?? option.area ?? 0;
      return {
        runsRequired,
        demandUnitsPerDay,
        stageProfitPerDay,
        adjStageProfitPerDay,
        selfAreaPerDay,
        fullAreaCapacity,
        totalProfitPA: option.totalProfitPA,
        valuePerDay,
      };
    };

    const traverse = (option: ApiMakeOption, ctx: TraverseContext): TraverseResult => {
      const metrics = computeMetrics(option, ctx.demandUnitsPerDay);
      const labelRecipe = option.recipeId ? ` • ${option.recipeId}` : "";
      const label = `${option.ticker}${labelRecipe}`;
      const color = getMakeColor(ctx.depth);
      const hover = makeHover([
        `<b>${option.ticker}</b>${labelRecipe}`,
        option.scenario ? `Scenario: ${option.scenario}` : null,
        `Runs/day required: ${formatNumber(metrics.runsRequired, 3)}`,
        `Output/day: ${formatNumber(metrics.demandUnitsPerDay, 3)}`,
        `Stage profit/day: ${formatCurrency(metrics.stageProfitPerDay, 2)}`,
        `Adj. profit/day: ${formatCurrency(metrics.adjStageProfitPerDay, 2)}`,
        `Output value/day: ${formatCurrency(metrics.valuePerDay, 2)}`,
        `Self area/day: ${formatNumber(metrics.selfAreaPerDay, 3)}`,
        `Full area capacity/day: ${formatNumber(metrics.fullAreaCapacity, 3)}`,
        metrics.totalProfitPA != null
          ? `Profit / Area: ${formatNumber(metrics.totalProfitPA, 4)}`
          : null,
        ctx.depth === 0 && option.roiNarrowDays != null
          ? `ROI (narrow): ${formatNumber(option.roiNarrowDays, 2)} days`
          : null,
        ctx.depth === 0 && option.inputPaybackDays7 != null
          ? `Input payback (7d): ${formatNumber(option.inputPaybackDays7, 2)} days`
          : null,
      ]);

      const nodeIndex = ensureNode(ctx.nodeId, () => ({
        label,
        hover,
        color,
        customdata: {
          ticker: option.ticker,
          recipeId: option.recipeId,
          scenario: option.scenario,
          runsRequired: metrics.runsRequired,
          demandUnitsPerDay: metrics.demandUnitsPerDay,
          stageProfitPerDay: metrics.stageProfitPerDay,
          adjStageProfitPerDay: metrics.adjStageProfitPerDay,
        },
      }));

      const details = Array.isArray(option.madeInputDetails)
        ? option.madeInputDetails
        : [];

      details.forEach((detail, index) => {
        const unitsPerDay = (detail.amountNeeded || 0) * metrics.runsRequired;
        if (!Number.isFinite(unitsPerDay) || unitsPerDay <= 0) return;

        if (detail.source === "BUY" || !detail.details) {
          const totalCostPerDay = (detail.totalCostPerBatch || 0) * metrics.runsRequired;
          const unitCost =
            detail.unitCost != null
              ? detail.unitCost
              : detail.amountNeeded > 0
              ? (detail.totalCostPerBatch || 0) / detail.amountNeeded
              : null;
          const buyNodeId = `${ctx.nodeId}::BUY::${detail.ticker}::${index}`;
          const buyHover = makeHover([
            `<b>Buy ${detail.ticker}</b>`,
            `Scenario path: ${detail.scenarioName}`,
            `Units/day purchased: ${formatNumber(unitsPerDay, 3)}`,
            unitCost != null ? `Unit price: ${formatCurrency(unitCost, 2)}` : null,
            `Total cost/day: ${formatCurrency(totalCostPerDay, 2)}`,
          ]);
          const buyNodeIndex = ensureNode(buyNodeId, () => ({
            label: `Buy ${detail.ticker}`,
            hover: buyHover,
            color: palette.buy,
            customdata: {
              ticker: detail.ticker,
              unitsPerDay,
              totalCostPerDay,
              unitCost,
            },
          }));
          const linkHover = makeHover([
            `<b>${option.ticker} → Buy ${detail.ticker}</b>`,
            `Units/day: ${formatNumber(unitsPerDay, 3)}`,
            unitCost != null ? `Unit price: ${formatCurrency(unitCost, 2)}` : null,
            `Total cost/day: ${formatCurrency(totalCostPerDay, 2)}`,
          ]);
          pushLink(nodeIndex, buyNodeIndex, unitsPerDay, `Buy ${detail.ticker}`, linkHover, "rgba(249,115,22,0.45)");
          return;
        }

        const child = detail.details;
        if (!child) return;

        const childNodeId = `${ctx.nodeId}::MAKE::${detail.ticker}::${child.recipeId ?? index}`;
        const childResult = traverse(child, {
          nodeId: childNodeId,
          path: [...ctx.path, `${detail.ticker}-${index}`],
          demandUnitsPerDay: unitsPerDay,
          depth: ctx.depth + 1,
          parentTicker: option.ticker,
        });

        const linkHover = makeHover([
          `<b>${option.ticker} → ${child.ticker}</b>`,
          `Units/day: ${formatNumber(unitsPerDay, 3)}`,
          `Child runs/day: ${formatNumber(childResult.metrics.runsRequired, 3)}`,
          detail.childScenario ? `Child scenario: ${detail.childScenario}` : null,
        ]);

        const linkColor = `rgba(14,165,233,${Math.max(0.25, 0.5 - ctx.depth * 0.05)})`;
        pushLink(nodeIndex, childResult.nodeIndex, unitsPerDay, `Make ${detail.ticker}`, linkHover, linkColor);
      });

      return { nodeIndex, metrics };
    };

    const rootDemand = (best.output1Amount || 0) * (best.runsPerDay || 0);
    traverse(best, {
      nodeId: `ROOT::${best.ticker}`,
      path: [best.ticker],
      demandUnitsPerDay: rootDemand,
      depth: 0,
    });

    return {
      data: [
        {
          type: "sankey",
          orientation: "h",
          valueformat: ".2f",
          node: {
            pad: 18,
            thickness: 20,
            line: { color: "#e5e7eb", width: 1 },
            label: nodeLabels,
            color: nodeColors,
            hovertemplate: nodeHoverTemplates,
          },
          link: {
            source: linkSources,
            target: linkTargets,
            value: linkValues,
            label: linkLabels,
            hovertemplate: linkHoverTemplates,
            color: linkColors,
          },
        },
      ],
      layout: {
        title: {
          text: `${ticker} — Best Scenario Flow (${priceMode.toUpperCase()})`,
          x: 0.05,
          y: 0.97,
        },
        font: {
          family: "Inter, system-ui, sans-serif",
          size: 12,
        },
        margin: { t: 50, r: 40, b: 30, l: 40 },
        paper_bgcolor: "white",
        plot_bgcolor: "white",
      },
    };
  }, [best, ticker, priceMode]);

  if (!chart) return null;

  return <PlotlySankey data={chart.data} layout={chart.layout} />;
}

// app/components/Top5Table.tsx
"use client";

import { useMemo } from "react";
import PlotlyTable from "./PlotlyTable";

type Top5Option = {
  ticker: string;
  recipeId: string | null;
  scenario: string;
  baseProfitPerDay: number;
  totalAreaPerDay?: number;
  roiNarrowDays?: number | null;
  totalProfitPA?: number;
};

export default function Top5Table({ options }: { options: Top5Option[] }) {
  const tableData = useMemo(() => {
    // Helper formatting functions
    const fmt = (n: number | null | undefined) =>
      n != null && Number.isFinite(n)
        ? Math.abs(n) >= 1000
          ? n.toLocaleString(undefined, { maximumFractionDigits: 1 })
          : n.toFixed(1)
        : "n/a";

    const money = (n: number | null | undefined) =>
      n != null && Number.isFinite(n)
        ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
        : "n/a";

    // Extract and format data for each column
    const tickers = options.map((o) => o.ticker);
    const recipeIds = options.map((o) => o.recipeId || "—");
    const scenarios = options.map((o) => o.scenario || "—");
    const baseProfits = options.map((o) => money(o.baseProfitPerDay));
    const totalAreas = options.map((o) => fmt(o.totalAreaPerDay));
    const rois = options.map((o) =>
      o.roiNarrowDays != null ? `${fmt(o.roiNarrowDays)} days` : "n/a"
    );
    const profitPAs = options.map((o) => fmt(o.totalProfitPA));

    return {
      data: [
        {
          type: "table",
          columnwidth: [0.8, 1, 2.5, 1.2, 1, 1.2, 1], // scenario gets more width
          header: {
            values: [
              ["Ticker"],
              ["Recipe ID"],
              ["Scenario"],
              ["Base Profit/Day"],
              ["Total Area/Day"],
              ["ROI (narrow)"],
              ["Profit P/A"],
            ],
            align: "left",
            line: { width: 1, color: "#dee2e6" },
            fill: { color: "#2563eb" },
            font: {
              family:
                "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif",
              size: 12,
              color: "white",
            },
            height: 32,
          },
          cells: {
            values: [
              tickers,
              recipeIds,
              scenarios,
              baseProfits,
              totalAreas,
              rois,
              profitPAs,
            ],
            align: ["left", "left", "left", "right", "right", "right", "right"],
            line: { color: "#dee2e6", width: 1 },
            fill: {
              color: [
                options.map((_, i) => (i % 2 === 0 ? "#ffffff" : "#f8f9fa")),
              ],
            },
            font: {
              family:
                "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif",
              size: 11,
              color: "#212529",
            },
            height: 28,
          },
        } as any,
      ],
      layout: {
        margin: { l: 0, r: 0, t: 0, b: 0 },
        paper_bgcolor: "transparent",
      },
    };
  }, [options]);

  if (!options || options.length === 0) return null;

  return <PlotlyTable data={tableData.data} layout={tableData.layout} />;
}

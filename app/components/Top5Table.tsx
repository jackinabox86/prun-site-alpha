// app/components/Top5Table.tsx
"use client";

import React, { useMemo, useState } from "react";
import PlotlyTable from "./PlotlyTable";
import { scenarioDisplayName } from "@/core/scenario";
import BestScenarioSankey from "./BestScenarioSankey";

type Top5Option = {
  ticker: string;
  recipeId: string | null;
  scenario: string;
  baseProfitPerDay: number;
  totalAreaPerDay?: number;
  roiNarrowDays?: number | null;
  totalProfitPA?: number;
};

export default function Top5Table({ options, priceMode }: { options: Top5Option[]; priceMode?: string }) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
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
        ? `₳${Math.round(n).toLocaleString()}`
        : "n/a";

    // Extract and format data for each column
    const tickers = options.map((o) => o.ticker);
    const recipeIds = options.map((o) => o.recipeId || "—");
    const scenarios = options.map((o) => o.scenario ? scenarioDisplayName(o.scenario) : "—");
    const baseProfits = options.map((o) => money(o.baseProfitPerDay));
    const totalAreas = options.map((o) => fmt(o.totalAreaPerDay));
    const rois = options.map((o) =>
      o.roiNarrowDays != null ? `${fmt(o.roiNarrowDays)} days` : "n/a"
    );
    const profitPAs = options.map((o) => o.totalProfitPA != null && Number.isFinite(o.totalProfitPA) ? `₳${fmt(o.totalProfitPA)}` : "n/a");

    return {
      data: [
        {
          type: "table",
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
            align: "center",
            line: { width: 1, color: "#dee2e6" },
            fill: { color: "#2563eb" },
            font: {
              family:
                "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif",
              size: 13,
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
            align: "center",
            line: { color: "#dee2e6", width: 1 },
            fill: {
              color: [
                options.map((_, i) => (i % 2 === 0 ? "#ffffff" : "#f8f9fa")),
              ],
            },
            font: {
              family:
                "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif",
              size: 13,
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

  const toggleRow = (index: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Helper formatting functions for HTML table
  const fmt = (n: number | null | undefined) =>
    n != null && Number.isFinite(n)
      ? Math.abs(n) >= 1000
        ? n.toLocaleString(undefined, { maximumFractionDigits: 1 })
        : n.toFixed(1)
      : "n/a";

  const money = (n: number | null | undefined) =>
    n != null && Number.isFinite(n)
      ? `₳${Math.round(n).toLocaleString()}`
      : "n/a";

  return (
    <>
      <div style={{ position: "relative", zIndex: 1, marginBottom: 60, overflow: "hidden" }}>
        <PlotlyTable data={tableData.data} layout={tableData.layout} />
      </div>

      <div style={{ marginTop: 60, position: "relative", zIndex: 2, clear: "both" }}>
        <h3 style={{ marginBottom: 16 }}>Interactive HTML Table (Expandable)</h3>
        <table style={{
          width: "100%",
          borderCollapse: "collapse",
          border: "1px solid #dee2e6",
          display: "table"
        }}>
          <thead>
            <tr style={{ backgroundColor: "#2563eb", color: "white" }}>
              <th style={{ padding: "10px", border: "1px solid #dee2e6", textAlign: "center" }}>Expand</th>
              <th style={{ padding: "10px", border: "1px solid #dee2e6", textAlign: "center" }}>Ticker</th>
              <th style={{ padding: "10px", border: "1px solid #dee2e6", textAlign: "center" }}>Recipe ID</th>
              <th style={{ padding: "10px", border: "1px solid #dee2e6", textAlign: "center" }}>Scenario</th>
              <th style={{ padding: "10px", border: "1px solid #dee2e6", textAlign: "center" }}>Base Profit/Day</th>
              <th style={{ padding: "10px", border: "1px solid #dee2e6", textAlign: "center" }}>Total Area/Day</th>
              <th style={{ padding: "10px", border: "1px solid #dee2e6", textAlign: "center" }}>ROI (narrow)</th>
              <th style={{ padding: "10px", border: "1px solid #dee2e6", textAlign: "center" }}>Profit P/A</th>
            </tr>
          </thead>
          <tbody>
            {options.map((option, index) => (
              <React.Fragment key={`fragment-${index}`}>
                <tr
                  style={{
                    backgroundColor: index % 2 === 0 ? "#ffffff" : "#f8f9fa"
                  }}
                >
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>
                    <button
                      onClick={() => toggleRow(index)}
                      style={{
                        padding: "4px 12px",
                        cursor: "pointer",
                        backgroundColor: "#2563eb",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: 600
                      }}
                    >
                      {expandedRows.has(index) ? "−" : "+"}
                    </button>
                  </td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>{option.ticker}</td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>{option.recipeId || "—"}</td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>
                    {option.scenario ? scenarioDisplayName(option.scenario) : "—"}
                  </td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>{money(option.baseProfitPerDay)}</td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>{fmt(option.totalAreaPerDay)}</td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>
                    {option.roiNarrowDays != null ? `${fmt(option.roiNarrowDays)} days` : "n/a"}
                  </td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>
                    {option.totalProfitPA != null && Number.isFinite(option.totalProfitPA) ? `₳${fmt(option.totalProfitPA)}` : "n/a"}
                  </td>
                </tr>
                {expandedRows.has(index) && (
                  <tr>
                    <td colSpan={8} style={{ padding: "16px", border: "1px solid #dee2e6", backgroundColor: "#f8f9fa" }}>
                      <h4 style={{ marginTop: 0, marginBottom: 12 }}>Sankey Chart for {option.ticker}</h4>
                      <div style={{ maxHeight: "600px", overflowY: "auto", position: "relative", zIndex: 3 }}>
                        <BestScenarioSankey best={option as any} priceMode={priceMode as any} height={400} />
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

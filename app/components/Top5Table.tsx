// app/components/Top5Table.tsx
"use client";

import React, { useState } from "react";
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
      <div style={{ position: "relative", zIndex: 2, clear: "both" }}>
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
                    <td colSpan={8} style={{
                      padding: "16px",
                      border: "1px solid #dee2e6",
                      backgroundColor: "#f8f9fa"
                    }}>
                      <h4 style={{ marginTop: 0, marginBottom: 12 }}>Sankey Chart for {option.ticker}</h4>
                      <div style={{
                        maxHeight: "600px",
                        overflowY: "auto",
                        position: "relative",
                        isolation: "isolate",
                        marginBottom: "20px"
                      }}>
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

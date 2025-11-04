// app/components/Top20Table.tsx
"use client";

import React, { useState } from "react";
import { scenarioDisplayName } from "@/core/scenario";
import BestScenarioSankey from "./BestScenarioSankey";
import type { Exchange, PriceType } from "@/types";

type Top20Option = {
  ticker: string;
  recipeId: string | null;
  scenario: string;
  baseProfitPerDay: number;
  totalAreaPerDay?: number;
  roiNarrowDays?: number | null;
  roiBroadDays?: number | null;
  totalProfitPA?: number;
  buildCost?: number;
  totalBuildCost?: number;
  inputBuffer7?: number | null;
  totalInputBuffer7?: number | null;
  inputPaybackDays7Narrow?: number | null;
  inputPaybackDays7Broad?: number | null;
};

export default function Top20Table({ options, exchange, priceType }: { options: Top20Option[]; exchange?: Exchange; priceType?: PriceType }) {
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
              <th style={{ padding: "10px", border: "1px solid #dee2e6", textAlign: "center" }}>Building Profit/Day</th>
              <th style={{ padding: "10px", border: "1px solid #dee2e6", textAlign: "center" }}>Total Area/Day</th>
              <th style={{ padding: "10px", border: "1px solid #dee2e6", textAlign: "center" }}>ROI (narrow)</th>
              <th style={{ padding: "10px", border: "1px solid #dee2e6", textAlign: "center" }}>ROI (broad)</th>
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
                    {index === 0 ? (
                      <span style={{ color: "#6b7280", fontSize: "12px" }}>See Top</span>
                    ) : (
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
                    )}
                  </td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>{option.ticker}</td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>{option.recipeId || "—"}</td>
                  <td
                    style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center", cursor: "help" }}
                    title={option.scenario || ""}
                  >
                    {option.scenario ? scenarioDisplayName(option.scenario) : "—"}
                  </td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>{money(option.baseProfitPerDay)}</td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>{fmt(option.totalAreaPerDay)}</td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>
                    {option.roiNarrowDays != null ? `${fmt(option.roiNarrowDays)} days` : "n/a"}
                  </td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>
                    {option.roiBroadDays != null ? `${fmt(option.roiBroadDays)} days` : "n/a"}
                  </td>
                  <td style={{ padding: "8px", border: "1px solid #dee2e6", textAlign: "center" }}>
                    {option.totalProfitPA != null && Number.isFinite(option.totalProfitPA) ? `₳${fmt(option.totalProfitPA)}` : "n/a"}
                  </td>
                </tr>
                {expandedRows.has(index) && (
                  <tr>
                    <td colSpan={9} style={{
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
                        <BestScenarioSankey best={option as any} exchange={exchange} priceType={priceType} height={400} />
                      </div>

                      {/* Info Section */}
                      <div
                        style={{
                          backgroundColor: "#ffffff",
                          border: "1px solid #dee2e6",
                          borderRadius: 6,
                          padding: 16,
                          marginTop: 16,
                        }}
                      >
                        <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
                          {option.scenario && (
                            <div>
                              <strong>Scenario:</strong> {scenarioDisplayName(option.scenario)}
                            </div>
                          )}

                          <div>
                            <strong>Base profit/day:</strong> {money(option.baseProfitPerDay)}
                          </div>
                          <div>
                            <strong>Total Area/Day:</strong> {fmt(option.totalAreaPerDay)}
                          </div>
                          {((option as any).buildCost != null || option.roiNarrowDays != null) && (
                            <div>
                              <strong>Build Cost - Narrow (ROI):</strong> {money((option as any).buildCost)} ({option.roiNarrowDays != null && Number.isFinite(option.roiNarrowDays)
                                ? option.roiNarrowDays.toFixed(1).replace(/\.0$/, "")
                                : "n/a"} days)
                            </div>
                          )}
                          {((option as any).totalBuildCost != null || option.roiBroadDays != null) && (
                            <div>
                              <strong>Build Cost - Broad (ROI):</strong> {money((option as any).totalBuildCost)} ({option.roiBroadDays != null && Number.isFinite(option.roiBroadDays)
                                ? option.roiBroadDays.toFixed(1).replace(/\.0$/, "")
                                : "n/a"} days)
                            </div>
                          )}
                          {(option.inputBuffer7 != null || option.inputPaybackDays7Narrow != null) && (
                            <div>
                              <strong>Input Buffer 7d - Narrow (Payback):</strong> {money(option.inputBuffer7)} ({option.inputPaybackDays7Narrow != null && Number.isFinite(option.inputPaybackDays7Narrow)
                                ? option.inputPaybackDays7Narrow.toFixed(1).replace(/\.0$/, "")
                                : "n/a"} days)
                            </div>
                          )}
                          {(option.totalInputBuffer7 != null || option.inputPaybackDays7Broad != null) && (
                            <div>
                              <strong>Input Buffer 7d - Broad (Payback):</strong> {money(option.totalInputBuffer7)} ({option.inputPaybackDays7Broad != null && Number.isFinite(option.inputPaybackDays7Broad)
                                ? option.inputPaybackDays7Broad.toFixed(1).replace(/\.0$/, "")
                                : "n/a"} days)
                            </div>
                          )}
                          <div>
                            <strong>Profit P/A:</strong> {option.totalProfitPA != null && Number.isFinite(option.totalProfitPA) ? `₳${fmt(option.totalProfitPA)}` : "n/a"}
                          </div>
                        </div>
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

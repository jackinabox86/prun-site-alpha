// app/components/CondensedOptionsTable.tsx
"use client";

import React, { useState } from "react";
import { scenarioDisplayName } from "@/core/scenario";
import BestScenarioSankey from "./BestScenarioSankey";
import type { Exchange, PriceType } from "@/types";

type CondensedOption = {
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

export default function CondensedOptionsTable({ options, exchange, priceType }: { options: CondensedOption[]; exchange?: Exchange; priceType?: PriceType }) {
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
      <div style={{ position: "relative", zIndex: 2, clear: "both", overflowX: "auto" }}>
        <table className="terminal-table">
          <thead>
            <tr>
              <th style={{ textAlign: "center" }}>Expand</th>
              <th style={{ textAlign: "center" }}>Ticker</th>
              <th style={{ textAlign: "center" }}>Recipe ID</th>
              <th style={{ textAlign: "center" }}>Scenario</th>
              <th style={{ textAlign: "center" }}>Building Profit/Day</th>
              <th style={{ textAlign: "center" }}>Total Area/Day</th>
              <th style={{ textAlign: "center" }}>ROI (narrow)</th>
              <th style={{ textAlign: "center" }}>ROI (broad)</th>
              <th style={{ textAlign: "center" }}>Profit P/A</th>
            </tr>
          </thead>
          <tbody>
            {options.map((option, index) => (
              <React.Fragment key={`fragment-${index}`}>
                <tr>
                  <td style={{ textAlign: "center" }}>
                    {index === 0 ? (
                      <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>See Top</span>
                    ) : (
                      <button
                        onClick={() => toggleRow(index)}
                        className="terminal-button"
                        style={{
                          padding: "0.25rem 0.75rem",
                          fontSize: "0.875rem"
                        }}
                      >
                        {expandedRows.has(index) ? "−" : "+"}
                      </button>
                    )}
                  </td>
                  <td style={{ textAlign: "center", fontWeight: "bold", color: "var(--color-accent-primary)" }}>{option.ticker}</td>
                  <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{option.recipeId || <span style={{ color: "var(--color-text-muted)" }}>—</span>}</td>
                  <td
                    style={{ textAlign: "center", cursor: "help", fontSize: "0.875rem" }}
                    title={option.scenario || ""}
                  >
                    {option.scenario ? scenarioDisplayName(option.scenario) : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>
                    <span className="status-success">{money(option.baseProfitPerDay)}</span>
                  </td>
                  <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{fmt(option.totalAreaPerDay)}</td>
                  <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>
                    {option.roiNarrowDays != null ? `${fmt(option.roiNarrowDays)} days` : <span style={{ color: "var(--color-text-muted)" }}>n/a</span>}
                  </td>
                  <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>
                    {option.roiBroadDays != null ? `${fmt(option.roiBroadDays)} days` : <span style={{ color: "var(--color-text-muted)" }}>n/a</span>}
                  </td>
                  <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>
                    {option.totalProfitPA != null && Number.isFinite(option.totalProfitPA) ? <span className="status-success">₳{fmt(option.totalProfitPA)}</span> : <span style={{ color: "var(--color-text-muted)" }}>n/a</span>}
                  </td>
                </tr>
                {expandedRows.has(index) && (
                  <tr>
                    <td colSpan={9} style={{
                      padding: "1rem",
                      background: "var(--color-bg-primary)",
                      border: "1px solid var(--color-border-secondary)"
                    }}>
                      <h4 style={{ marginTop: 0, marginBottom: "1rem", color: "var(--color-accent-primary)", fontFamily: "var(--font-mono)", fontSize: "1rem" }}>
                        SANKEY CHART // {option.ticker}
                      </h4>
                      <div style={{
                        maxHeight: "600px",
                        overflowY: "auto",
                        position: "relative",
                        isolation: "isolate",
                        marginBottom: "1rem"
                      }}>
                        <BestScenarioSankey best={option as any} exchange={exchange} priceType={priceType} height={400} />
                      </div>

                      {/* Info Section */}
                      <div
                        style={{
                          background: "var(--color-bg-secondary)",
                          border: "1px solid var(--color-border-primary)",
                          borderRadius: "2px",
                          padding: "1rem",
                          marginTop: "1rem",
                        }}
                      >
                        <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.875rem", fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)" }}>
                          {option.scenario && (
                            <div>
                              <strong style={{ color: "var(--color-text-primary)" }}>Scenario:</strong> {scenarioDisplayName(option.scenario)}
                            </div>
                          )}
                          <div>
                            <strong style={{ color: "var(--color-text-primary)" }}>Base profit/day:</strong> <span className="text-accent">{money(option.baseProfitPerDay)}</span>
                          </div>
                          <div>
                            <strong style={{ color: "var(--color-text-primary)" }}>Total Area/Day:</strong> <span className="text-accent">{fmt(option.totalAreaPerDay)}</span>
                          </div>
                          {((option as any).buildCost != null || option.roiNarrowDays != null) && (
                            <div>
                              <strong style={{ color: "var(--color-text-primary)" }}>Build Cost - Narrow (ROI):</strong> <span className="text-accent">{money((option as any).buildCost)} ({option.roiNarrowDays != null && Number.isFinite(option.roiNarrowDays)
                                ? option.roiNarrowDays.toFixed(1).replace(/\.0$/, "")
                                : "n/a"} days)</span>
                            </div>
                          )}
                          {((option as any).totalBuildCost != null || option.roiBroadDays != null) && (
                            <div>
                              <strong style={{ color: "var(--color-text-primary)" }}>Build Cost - Broad (ROI):</strong> <span className="text-accent">{money((option as any).totalBuildCost)} ({option.roiBroadDays != null && Number.isFinite(option.roiBroadDays)
                                ? option.roiBroadDays.toFixed(1).replace(/\.0$/, "")
                                : "n/a"} days)</span>
                            </div>
                          )}
                          {(option.inputBuffer7 != null || option.inputPaybackDays7Narrow != null) && (
                            <div>
                              <strong style={{ color: "var(--color-text-primary)" }}>Input Buffer 7d - Narrow (Payback):</strong> <span className="text-accent">{money(option.inputBuffer7)} ({option.inputPaybackDays7Narrow != null && Number.isFinite(option.inputPaybackDays7Narrow)
                                ? option.inputPaybackDays7Narrow.toFixed(1).replace(/\.0$/, "")
                                : "n/a"} days)</span>
                            </div>
                          )}
                          {(option.totalInputBuffer7 != null || option.inputPaybackDays7Broad != null) && (
                            <div>
                              <strong style={{ color: "var(--color-text-primary)" }}>Input Buffer 7d - Broad (Payback):</strong> <span className="text-accent">{money(option.totalInputBuffer7)} ({option.inputPaybackDays7Broad != null && Number.isFinite(option.inputPaybackDays7Broad)
                                ? option.inputPaybackDays7Broad.toFixed(1).replace(/\.0$/, "")
                                : "n/a"} days)</span>
                            </div>
                          )}
                          <div>
                            <strong style={{ color: "var(--color-text-primary)" }}>Profit P/A:</strong> <span className="text-accent">{option.totalProfitPA != null && Number.isFinite(option.totalProfitPA) ? `₳${fmt(option.totalProfitPA)}` : "n/a"}</span>
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

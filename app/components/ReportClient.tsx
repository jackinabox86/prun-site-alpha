"use client";

import { useEffect, useMemo, useState } from "react";
import type { PriceMode } from "@/types";
import BestScenarioSankey from "./BestScenarioSankey";
import Top20Table from "./Top20Table";
import { scenarioDisplayName } from "@/core/scenario";

type ApiReport = {
  schemaVersion: number;
  ok?: boolean;
  error?: string;
  ticker: string;
  priceMode: PriceMode;
  totalOptions: number;
  bestPA: number | null;
  best: any;
  top20: any[];
};

export default function ReportClient() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [tickerInput, setTickerInput] = useState<string>("REP");
  const [priceMode, setPriceMode] = useState<PriceMode>("bid");
  const [expand, setExpand] = useState(false);
  const [includeRows, setIncludeRows] = useState(false);

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ApiReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readmeHidden, setReadmeHidden] = useState(false);

  useEffect(() => {
    fetch("/api/tickers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load tickers"))))
      .then((data: { tickers: string[] }) => setTickers(data.tickers ?? []))
      .catch(() => setTickers([]));
  }, []);

  const filteredTickers = useMemo(() => {
    if (!tickerInput) return tickers.slice(0, 50);
    const q = tickerInput.toUpperCase();
    return tickers.filter((t) => t.toUpperCase().startsWith(q)).slice(0, 50);
  }, [tickers, tickerInput]);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        ticker: tickerInput.trim().toUpperCase(),
        priceMode,
        ...(expand ? { expand: "1" } : {}),
        ...(includeRows ? { rows: "1" } : {}),
      });
      const res = await fetch(`/api/report?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `${res.status} ${res.statusText}`);
      }
      setReport(json as ApiReport);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper formatting functions matching the Sankey component
  const fmt = (n: number | null | undefined) =>
    n != null && Number.isFinite(n) 
      ? (Math.abs(n) >= 1000 ? n.toLocaleString() : n.toFixed(3))
      : "n/a";
  
  const money = (n: number | null | undefined) =>
    n != null && Number.isFinite(n)
      ? `₳${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : "n/a";

  return (
    <>
      <style>{`
        [data-tooltip] {
          position: relative;
        }
        [data-tooltip]::after {
          content: attr(data-tooltip);
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          padding: 6px 10px;
          background-color: #333;
          color: #fff;
          font-size: 13px;
          white-space: nowrap;
          border-radius: 4px;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s;
          margin-bottom: 5px;
          z-index: 1000;
        }
        [data-tooltip]:hover::after {
          opacity: 1;
        }
      `}</style>
      <main style={{
        padding: "24px 0",
        maxWidth: "100%",
        fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
      }}>
      <div style={{ padding: "0 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", maxWidth: 900, margin: "0 0 16px", paddingRight: "24px" }}>
          <h2 style={{ margin: 0, textAlign: "center", flex: 1 }}>PrUn Ticker Analysis - Best Profit Per Area Production Scenario</h2>
          <button
            onClick={() => setReadmeHidden(!readmeHidden)}
            style={{
              padding: "6px 12px",
              fontWeight: 600,
              fontFamily: "inherit",
              backgroundColor: readmeHidden ? "#a8d5a8" : "#e8a4a4",
              border: "1px solid " + (readmeHidden ? "#7cb17c" : "#c87878"),
              borderRadius: 4,
              cursor: "pointer",
              whiteSpace: "nowrap"
            }}
          >
            {readmeHidden ? "Expand Readme" : "Hide Readme"}
          </button>
        </div>
                    {!readmeHidden && <p style={{ margin: "8px 0 16px", color: "#555", maxWidth: 900 }}>
                      This tool determines and displays the highest profit per area production scenario for the selected ticker.
                      A production scenario is the buy/make decision for each input in a ticker's production chain.
                      This model uses FIO data (refreshed hourly) for its calculations on optimal buy/make decisions.
                      Importantly, it also displays the same profit per area metric for each made input independently to avoid unintended opportunity costs.
                    </p>}
                    {!readmeHidden && <p style={{ margin: "8px 0 16px", color: "#555", maxWidth: 900 }}>
                      Below the main analysis is a ranked table of other profitable production scenarios for the selected ticker, which can be expanded if desired for full analysis.
                      Future versions of this tool may allow input-level buy make selections, but that is not yet implemented.
                    </p>}
                    {!readmeHidden && <p style={{ margin: "8px 0 16px", color: "#555", maxWidth: 900 }}>
                      Each ticker on the sankey chain has a node and tooltip with additional info on its profitability.
                      The flows between nodes are sized according to the relative proportion of an inputs value to the parent's total cost;
                      tickers with broader flows can be prioritized when optimizing for profitability.
                      Full credit to Taiyi for the Sankey inspiration.
                    </p>}
      </div>

      {/* Controls */}
      <div style={{ padding: "0 24px" }}>
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "1fr auto auto",
            alignItems: "end",
            maxWidth: 900,
          }}
        >
        <div>
          <label style={{ display: "block", fontSize: 14, marginBottom: 4 }}>
            Ticker
          </label>
          <input
            list="ticker-list"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            placeholder="Type a ticker (e.g., PCB)"
            style={{ width: "100%", padding: "8px 10px", fontWeight: 600, fontFamily: "inherit" }}
          />
          <datalist id="ticker-list">
            {filteredTickers.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 14,  marginBottom: 4 }}>
            Price Mode
          </label>
          <select
            value={priceMode}
            onChange={(e) => setPriceMode(e.target.value as PriceMode)}
            style={{ padding: "8px 10px", fontWeight: 600, fontFamily: "inherit" }}
          >
            <option value="bid">bid</option>
            <option value="ask">ask</option>
            <option value="pp7">pp7</option>
            <option value="pp30">pp30</option>
          </select>
        </div>

        <button
          onClick={run}
          disabled={loading || !tickerInput.trim()}
          style={{ padding: "10px 14px", fontWeight: 600, fontFamily: "inherit" }}
        >
          {loading ? "Running..." : "Run"}
        </button>
        </div>
      </div>

      {/* Summary */}
      <div style={{ padding: "0 24px" }}>
        {error && (
          <p style={{ marginTop: 12, color: "#b00" }}>
            Error: {error}
          </p>
        )}

        {report && (
          <>
            {/* Results */}
            {report && !error && (
              <>
                {report.best ? (
                  <section style={{ marginTop: 10 }}>

                    {/* Summary Box */}
                    <div
                      style={{
                        backgroundColor: "#f8f9fa",
                        border: "1px solid #dee2e6",
                        borderRadius: 6,
                        padding: 16,
                        marginBottom: 10,
                        maxWidth: 867,
                      }}
                    >
                                        <p style={{ margin: "0 0 12px 0", fontSize: 18 }}>
                      <strong>Best P/A:</strong>{" "}
                      {report.bestPA != null ? Number(report.bestPA).toFixed(6) : "n/a"}  &nbsp; | &nbsp;
                      {report.best.scenario && (
                        <>
                          <strong>Scenario:</strong> {scenarioDisplayName(report.best.scenario)}  &nbsp; | &nbsp;
                        </>
                      )}
                      <strong>Mode:</strong> {report.priceMode}
                    </p>
                    <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
                      

                      <div>
                        <strong>Base profit/day:</strong> {money(report.best.baseProfitPerDay)}
                      </div>
                      <div>
                        <strong>Total Area/Day:</strong> {report.best.totalAreaPerDay != null && Number.isFinite(report.best.totalAreaPerDay)
                          ? report.best.totalAreaPerDay.toFixed(1).replace(/\.0$/, "")
                          : "n/a"}
                      </div>
                      <div>
                        <strong>Runs/day:</strong> {report.best.runsPerDay != null && Number.isFinite(report.best.runsPerDay)
                          ? report.best.runsPerDay.toFixed(1).replace(/\.0$/, "")
                          : "n/a"}
                      </div>
                      {report.best.roiNarrowDays != null && (
                        <div>
                          <strong>ROI (narrow):</strong> {Number.isFinite(report.best.roiNarrowDays)
                            ? report.best.roiNarrowDays.toFixed(1).replace(/\.0$/, "")
                            : "n/a"} days
                        </div>
                      )}
                      {report.best.inputBuffer7 != null && (
                        <div>
                          <strong>Input buffer (7d):</strong> {money(report.best.inputBuffer7)}
                        </div>
                      )}
                      {report.best.scenario && (
                        <div style={{ marginTop: 8, fontStyle: "italic", fontSize: 14, color: "#666" }}>
                          Full Scenario Name: {report.best.scenario}
                        </div>
                      )}
                      
                    </div>
                  </div>
                  
                </section>
              ) : (
                <p style={{ marginTop: 32 }}>No best scenario available for this ticker.</p>
              )}
            </>
          )}
        </>
      )}
      </div>

      {/* Sankey Chart - Full Width */}
      {report && !error && report.best && (
        <div
          key={`sankey-${report.ticker}-${report.best.scenario}`}
          style={{
            margin: "2px 0",
            padding: "0 20px",
            position: "relative",
            isolation: "isolate",
            zIndex: 1
          }}
        >
          <BestScenarioSankey best={report.best} priceMode={report.priceMode} />
        </div>
      )}

      <div style={{ padding: "0 24px" }}>
        {report && !error && (
          <section style={{
            marginTop: 10,
            position: "relative",
            isolation: "isolate",
            zIndex: 2,
            paddingTop: "0px"
          }}>
            {report.best && (
              <div style={{ marginTop: 8, fontSize: 14, color: "#666", textAlign: "center" }}>
                <strong>Sankey Key:</strong>{" "}
                <span
                  data-tooltip="Placeholder text for Parent Node"
                  style={{
                    position: "relative",
                    cursor: "help",
                    borderBottom: "1px dotted #999"
                  }}
                >
                  Parent Node
                </span>
                {" | "}
                <span
                  data-tooltip="Placeholder text for Input Node"
                  style={{
                    position: "relative",
                    cursor: "help",
                    borderBottom: "1px dotted #999"
                  }}
                >
                  Input Node
                </span>
                {" | "}
                <span
                  data-tooltip="Placeholder text for Flows"
                  style={{
                    position: "relative",
                    cursor: "help",
                    borderBottom: "1px dotted #999"
                  }}
                >
                  Flows
                </span>
              </div>
            )}
            <h2>Top Options</h2>
            <p style={{ margin: "8px 0 16px", color: "#555", maxWidth: 760 }}>
              List of up to 20 other production scenarios ranked by profit per area.
            </p>
            <Top20Table options={report.top20} priceMode={report.priceMode} />
          </section>
        )}
      </div>
    </main>
    </>
  );
}

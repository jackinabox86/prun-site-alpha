"use client";

import { useEffect, useMemo, useState } from "react";
import type { PriceMode, Exchange, PriceType } from "@/types";
import BestScenarioSankey from "./BestScenarioSankey";
import Top20Table from "./Top20Table";
import CondensedOptionsTable from "./CondensedOptionsTable";
import { scenarioDisplayName } from "@/core/scenario";

type ApiReport = {
  schemaVersion: number;
  ok?: boolean;
  error?: string;
  ticker: string;
  exchange: Exchange;
  priceType: PriceType;
  totalOptions: number;
  bestPA: number | null;
  best: any;
  top20: any[];
  topDisplayScenarios: any[];
};

export default function ReportClient() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [tickerInput, setTickerInput] = useState<string>("CBS");
  const [exchange, setExchange] = useState<Exchange>("ANT");
  const [priceType, setPriceType] = useState<PriceType>("bid");
  const [priceSource, setPriceSource] = useState<"local" | "gcs">("gcs");
  const [urlParamsChecked, setUrlParamsChecked] = useState(false);
  const [forceMake, setForceMake] = useState<string>("");
  const [forceBuy, setForceBuy] = useState<string>("");

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

  // Read ticker from URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tickerParam = params.get("ticker");
    if (tickerParam) {
      setTickerInput(tickerParam.toUpperCase());
    }
    setUrlParamsChecked(true);
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
      const params: Record<string, string> = {
        ticker: tickerInput.trim().toUpperCase(),
        exchange,
        priceType,
        priceSource,
      };

      // Only include forceMake and forceBuy if they're not empty
      if (forceMake.trim()) {
        params.forceMake = forceMake.trim();
      }
      if (forceBuy.trim()) {
        params.forceBuy = forceBuy.trim();
      }

      const qs = new URLSearchParams(params);
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
    if (urlParamsChecked) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlParamsChecked]);

  // Helper formatting function matching the Sankey component
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
          left: 0;
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
            gap: 20,
            gridTemplateColumns: "60px 50px 52px 120px 500px",
            alignItems: "end",
            maxWidth: 900,
          }}
        >
        <div>
          <label style={{ display: "block", fontSize: 14, marginBottom: 4, textAlign: "center" }}>
            Ticker
          </label>
          <input
            list="ticker-list"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", fontWeight: 600, fontFamily: "inherit" }}
          />
          <datalist id="ticker-list">
            {filteredTickers.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 14,  marginBottom: 4, textAlign: "center" }}>
            Exchange
          </label>
          <select
            value={exchange}
            onChange={(e) => setExchange(e.target.value as Exchange)}
            style={{ padding: "8px 10px", fontWeight: 600, fontFamily: "inherit" }}
          >
            <option value="ANT">ANT</option>
            <option value="CIS">CIS</option>
            <option value="ICA">ICA</option>
            <option value="NCC">NCC</option>
            <option value="UNV">UNV</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 14,  marginBottom: 4, textAlign: "center" }}>
            Sell At
          </label>
          <select
            value={priceType}
            onChange={(e) => setPriceType(e.target.value as PriceType)}
            style={{ padding: "8px 10px", fontWeight: 600, fontFamily: "inherit" }}
          >
            <option value="ask">Ask</option>
            <option value="bid">Bid</option>
            <option value="pp7">PP7</option>
            <option value="pp30">PP30</option>
          </select>
        </div>

        <button
          onClick={run}
          disabled={loading || !tickerInput.trim()}
          style={{ padding: "8px 10px", fontWeight: 600, fontFamily: "inherit" }}
        >
          {loading ? "Running..." : "Run"}
        </button>

        <div style={{ fontSize: 20, paddingBottom: 6 }}>
          {exchange === "ANT" ? "😊" : "😢"}
        </div>
        </div>

        {/* Force Make/Buy Controls */}
        <div
          style={{
            display: "grid",
            gap: 20,
            gridTemplateColumns: "1fr 1fr",
            alignItems: "end",
            maxWidth: 900,
            marginTop: 16,
          }}
        >
          <div>
            <label style={{ display: "block", fontSize: 14, marginBottom: 4 }}>
              Force Make (comma-separated tickers)
            </label>
            <input
              type="text"
              value={forceMake}
              onChange={(e) => setForceMake(e.target.value)}
              placeholder="e.g., C, H2O, PE"
              style={{ width: "100%", padding: "8px 10px", fontFamily: "inherit" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 14, marginBottom: 4 }}>
              Force Buy (comma-separated tickers)
            </label>
            <input
              type="text"
              value={forceBuy}
              onChange={(e) => setForceBuy(e.target.value)}
              placeholder="e.g., H, O, FE"
              style={{ width: "100%", padding: "8px 10px", fontFamily: "inherit" }}
            />
          </div>
        </div>
      </div>

      {/* Summary */}
      <div style={{ padding: "0 24px" }}>
        {error && (
          <p style={{ marginTop: 12, color: "#b00" }}>
            Error: {error}
          </p>
        )}

        {report && report.error && (
          <p style={{ marginTop: 12, color: "#b00" }}>
            {report.error}
          </p>
        )}

        {report && (
          <>
            {/* Results */}
            {report && !error && !report.error && (
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
                                        <p style={{ margin: "0 0 12px 0", fontSize: 16, paddingLeft: "20px" }}>
                      <strong> {report.ticker} </strong> &nbsp; | &nbsp;
                      <strong>Best P/A:</strong>{" "}
                      {report.bestPA != null ? Number(report.bestPA).toFixed(6) : "n/a"}   | &nbsp;
                      {report.best.scenario && (
                        <>
                          <strong>Scenario:</strong> {scenarioDisplayName(report.best.scenario)}   | &nbsp;
                        </>
                      )}
                      <strong>Options Run:</strong> {report.totalOptions.toLocaleString()}
                    </p>
                    <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
                      

                      <div>
                        <span
                          data-tooltip="Placeholder text for building profit/day"
                          style={{
                            position: "relative",
                            cursor: "help",
                            marginRight: "6px"
                          }}
                        >
                          ⓘ
                        </span>
                        <strong>Building Profit/Day:</strong> {money(report.best.baseProfitPerDay)}
                      </div>
                      <div>
                        <span
                          data-tooltip="Placeholder text for Total Area/Day"
                          style={{
                            position: "relative",
                            cursor: "help",
                            marginRight: "6px"
                          }}
                        >
                          ⓘ
                        </span>
                        <strong>Total Area/Day:</strong> {report.best.totalAreaPerDay != null && Number.isFinite(report.best.totalAreaPerDay)
                          ? report.best.totalAreaPerDay.toFixed(1).replace(/\.0$/, "")
                          : "n/a"}
                      </div>
                      <div>
                        <span
                          data-tooltip="Placeholder text for Runs/day"
                          style={{
                            position: "relative",
                            cursor: "help",
                            marginRight: "6px"
                          }}
                        >
                          ⓘ
                        </span>
                        <strong>Runs/day:</strong> {report.best.runsPerDay != null && Number.isFinite(report.best.runsPerDay)
                          ? report.best.runsPerDay.toFixed(1).replace(/\.0$/, "")
                          : "n/a"}
                      </div>
                      {(report.best.buildCost != null || report.best.roiNarrowDays != null) && (
                        <div>
                          <span
                            data-tooltip="Placeholder text for Build Cost - Narrow (ROI)"
                            style={{
                              position: "relative",
                              cursor: "help",
                              marginRight: "6px"
                            }}
                          >
                            ⓘ
                          </span>
                          <strong>Build Cost - Narrow (ROI):</strong> {money(report.best.buildCost)} ({Number.isFinite(report.best.roiNarrowDays)
                            ? report.best.roiNarrowDays.toFixed(1).replace(/\.0$/, "")
                            : "n/a"} days)
                        </div>
                      )}
                      {(report.best.totalBuildCost != null || report.best.roiBroadDays != null) && (
                        <div>
                          <span
                            data-tooltip="Placeholder text for Build Cost - Broad (ROI)"
                            style={{
                              position: "relative",
                              cursor: "help",
                              marginRight: "6px"
                            }}
                          >
                            ⓘ
                          </span>
                          <strong>Build Cost - Broad (ROI):</strong> {money(report.best.totalBuildCost)} ({Number.isFinite(report.best.roiBroadDays)
                            ? report.best.roiBroadDays.toFixed(1).replace(/\.0$/, "")
                            : "n/a"} days)
                        </div>
                      )}
                      {(report.best.inputBuffer7 != null || report.best.inputPaybackDays7Narrow != null) && (
                        <div>
                          <span
                            data-tooltip="Placeholder text for Input Buffer 7d - Narrow (Payback)"
                            style={{
                              position: "relative",
                              cursor: "help",
                              marginRight: "6px"
                            }}
                          >
                            ⓘ
                          </span>
                          <strong>Input Buffer 7d - Narrow (Payback):</strong> {money(report.best.inputBuffer7)} ({Number.isFinite(report.best.inputPaybackDays7Narrow)
                            ? report.best.inputPaybackDays7Narrow.toFixed(1).replace(/\.0$/, "")
                            : "n/a"} days)
                        </div>
                      )}
                      {(report.best.totalInputBuffer7 != null || report.best.inputPaybackDays7Broad != null) && (
                        <div>
                          <span
                            data-tooltip="Placeholder text for Input Buffer 7d - Broad (Payback)"
                            style={{
                              position: "relative",
                              cursor: "help",
                              marginRight: "6px"
                            }}
                          >
                            ⓘ
                          </span>
                          <strong>Input Buffer 7d - Broad (Payback):</strong> {money(report.best.totalInputBuffer7)} ({Number.isFinite(report.best.inputPaybackDays7Broad)
                            ? report.best.inputPaybackDays7Broad.toFixed(1).replace(/\.0$/, "")
                            : "n/a"} days)
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
      {report && !error && !report.error && report.best && (
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
          <BestScenarioSankey best={report.best} exchange={report.exchange} priceType={report.priceType} />
        </div>
      )}

      <div style={{ padding: "0 24px" }}>
        {report && !error && !report.error && (
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
            <h2>Best Options - Condensed</h2>
            <p style={{ margin: "8px 0 16px", color: "#555", maxWidth: 760 }}>
              Best performing option for each unique display scenario (up to 20). Display scenarios show only the buy/make decisions for direct inputs, not their sub-components.
            </p>
            <CondensedOptionsTable options={report.topDisplayScenarios} exchange={report.exchange} priceType={report.priceType} />

            <h2 style={{ marginTop: 32 }}>Best Options - Expanded</h2>
            <p style={{ margin: "8px 0 16px", color: "#555", maxWidth: 760 }}>
              List of up to 20 other production scenarios ranked by profit per area, including multiple full scenarios per display scenario.
            </p>
            <Top20Table options={report.top20} exchange={report.exchange} priceType={report.priceType} />
          </section>
        )}
      </div>

      {/* Source selector - bottom right corner */}
      <div style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        backgroundColor: "white",
        border: "1px solid #ccc",
        borderRadius: "6px",
        padding: "12px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        zIndex: 1000
      }}>
        <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "#666" }}>
          Source
        </label>
        <select
          value={priceSource}
          onChange={(e) => setPriceSource(e.target.value as "local" | "gcs")}
          style={{ padding: "6px 8px", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}
        >
          <option value="local">Local</option>
          <option value="gcs">GCS</option>
        </select>
      </div>
    </main>
    </>
  );
}

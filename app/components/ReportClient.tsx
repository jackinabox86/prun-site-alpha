"use client";

import { useEffect, useMemo, useState } from "react";
import type { PriceMode } from "@/types";
import BestScenarioSankey from "./BestScenarioSankey";

type ApiReport = {
  schemaVersion: number;
  ok?: boolean;
  error?: string;
  ticker: string;
  priceMode: PriceMode;
  totalOptions: number;
  bestPA: number | null;
  best: any;
  top5: any[];
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
      ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` 
      : "n/a";

  return (
    <main style={{ padding: 24 }}>
      <h1>Report (live Sheets)</h1>

      {/* Controls */}
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "1fr auto auto auto auto",
          alignItems: "end",
          maxWidth: 900,
        }}
      >
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>
            Ticker
          </label>
          <input
            list="ticker-list"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            placeholder="Type a ticker (e.g., PCB)"
            style={{ width: "100%", padding: "8px 10px" }}
          />
          <datalist id="ticker-list">
            {filteredTickers.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>
            Price Mode
          </label>
          <select
            value={priceMode}
            onChange={(e) => setPriceMode(e.target.value as PriceMode)}
            style={{ padding: "8px 10px" }}
          >
            <option value="bid">bid</option>
            <option value="ask">ask</option>
            <option value="pp7">pp7</option>
            <option value="pp30">pp30</option>
          </select>
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={expand}
            onChange={(e) => setExpand(e.target.checked)}
          />
          Expand children
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={includeRows}
            onChange={(e) => setIncludeRows(e.target.checked)}
          />
          Include rows
        </label>

        <button
          onClick={run}
          disabled={loading || !tickerInput.trim()}
          style={{ padding: "10px 14px", fontWeight: 600 }}
        >
          {loading ? "Running..." : "Run"}
        </button>
      </div>

      {/* Summary */}
      {error && (
        <p style={{ marginTop: 12, color: "#b00" }}>
          Error: {error}
        </p>
      )}

      {report && (
        <>
          <p style={{ marginTop: 12 }}>
            <strong>Ticker:</strong> {report.ticker} &nbsp; | &nbsp;
            <strong>Mode:</strong> {report.priceMode} &nbsp; | &nbsp;
            <strong>Total Options:</strong> {report.totalOptions} &nbsp; | &nbsp;
            <strong>Best P/A:</strong>{" "}
            {report.bestPA != null ? Number(report.bestPA).toFixed(6) : "n/a"}
          </p>

          {/* Results */}
          {report && !error && (
            <>
              {report.best ? (
                <section style={{ marginTop: 32 }}>
                  <h2>Best Scenario Sankey</h2>
                  <p style={{ margin: "8px 0 16px", color: "#555", maxWidth: 760 }}>
                    Visualizes the best-performing production chain. Each link width represents
                    units consumed per day; hover nodes or links for profit, area, and sourcing
                    context.
                  </p>

                  {/* Summary Box - duplicates parent node hover info */}
                  <div
                    style={{
                      backgroundColor: "#f8f9fa",
                      border: "1px solid #dee2e6",
                      borderRadius: 6,
                      padding: 16,
                      marginBottom: 16,
                      maxWidth: 760,
                    }}
                  >
                    <h3 style={{ margin: "0 0 12px 0", fontSize: 16, fontWeight: 600 }}>
                      {report.best.ticker}
                    </h3>
                    <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
                      {report.best.scenario && (
                        <div>
                          <strong>Scenario:</strong> {report.best.scenario}
                        </div>
                      )}
                      <div>
                        <strong>Price mode:</strong> {report.priceMode}
                      </div>
                      <div>
                        <strong>Runs/day:</strong> {fmt(report.best.runsPerDay)}
                      </div>
                      <div>
                        <strong>Output1 amount:</strong> {fmt(report.best.output1Amount)}
                      </div>
                      <div>
                        <strong>Base profit/day:</strong> {money(report.best.baseProfitPerDay)}
                      </div>
                      <div>
                        <strong>Adj. profit/day:</strong> {money(report.best.profitPerDay)}
                      </div>
                      <div>
                        <strong>Area/day (full):</strong> {fmt(report.best.fullSelfAreaPerDay)}
                      </div>
                      {report.best.roiNarrowDays != null && (
                        <div>
                          <strong>ROI (narrow):</strong> {fmt(report.best.roiNarrowDays)} days
                        </div>
                      )}
                      {report.best.inputBuffer7 != null && (
                        <div>
                          <strong>Input buffer (7d):</strong> {money(report.best.inputBuffer7)}
                        </div>
                      )}
                    </div>
                  </div>

                  <BestScenarioSankey best={report.best} priceMode={report.priceMode} />
                </section>
              ) : (
                <p style={{ marginTop: 32 }}>No best scenario available for this ticker.</p>
              )}

              <section style={{ marginTop: 32 }}>
                <details>
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                    Inspect raw best scenario data
                  </summary>
                  <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>
                    {JSON.stringify(report.best, null, 2)}
                  </pre>
                </details>
              </section>

              <section style={{ marginTop: 32 }}>
                <details>
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                    View top 5 options (JSON)
                  </summary>
                  <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>
                    {JSON.stringify(report.top5, null, 2)}
                  </pre>
                </details>
              </section>

              <p style={{ marginTop: 24, color: "#666" }}>
                Tip: try <code>?ticker=XYZ&amp;mode=pp7</code> or toggle <strong>Expand children</strong> to
                include child rows in the best option.
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}

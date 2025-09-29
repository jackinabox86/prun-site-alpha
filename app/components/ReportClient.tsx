"use client";

import { useEffect, useMemo, useState } from "react";
import type { PriceMode } from "@/types";

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
  const [tickerInput, setTickerInput] = useState<string>("REP"); // default you set
  const [priceMode, setPriceMode] = useState<PriceMode>("bid");
  const [expand, setExpand] = useState(false);
  const [includeRows, setIncludeRows] = useState(false);

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ApiReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load tickers once (from a tiny API that reads your CSVs)
  useEffect(() => {
    fetch("/api/tickers", { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("Failed to load tickers")))
      .then((data: { tickers: string[] }) => setTickers(data.tickers ?? []))
      .catch(() => setTickers([]));
  }, []);

  const filteredTickers = useMemo(() => {
    if (!tickerInput) return tickers.slice(0, 50);
    const q = tickerInput.toUpperCase();
    return tickers.filter(t => t.toUpperCase().startsWith(q)).slice(0, 50);
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
      setReport(json);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // run once on mount with defaults
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Report (live Sheets)</h1>

      {/* Controls */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr auto auto auto auto", alignItems: "end", maxWidth: 900 }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>Ticker</label>
          <input
            list="ticker-list"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            placeholder="Type a ticker (e.g., PCB)"
            style={{ width: "100%", padding: "8px 10px" }}
          />
          <datalist id="ticker-list">
            {filteredTickers.map(t => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>Price Mode</label>
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
          <input type="checkbox" checked={expand} onChange={(e) => setExpand(e.target.checked)} />
          Expand children
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={includeRows} onChange={(e) => setIncludeRows(e.target.checked)} />
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

          <h2>Best Scenario (raw)</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(report.best, null, 2)}
          </pre>

          <h2>Top 5 (summary only)</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(report.top5, null, 2)}
          </pre>

          <p style={{ marginTop: 16, color: "#666" }}>
            Tip: try <code>?ticker=XYZ&amp;mode=pp7</code>. For a human-readable tree,
            turn on <em>Include rows</em> (and optionally <em>Expand children</em>).
          </p>
        </>
      )}
    </main>
  );
}

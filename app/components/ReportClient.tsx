"use client";

import { useEffect, useMemo, useState } from "react";
import type { PriceMode } from "@/types";
import BestScenarioSankey from "./BestScenarioSankey";

type ApiReport = any; // keep your existing type if you have one

export default function ReportClient() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [tickerInput, setTickerInput] = useState<string>("REP"); // free-typed value
  const [priceMode, setPriceMode] = useState<PriceMode>("bid");
  const [expand, setExpand] = useState<boolean>(false);

  const [data, setData] = useState<ApiReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load tickers for suggestions
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tickers", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        setTickers(Array.isArray(json?.tickers) ? json.tickers : []);
      } catch {
        /* non-fatal for UI */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Filter suggestions to those that START WITH what the user typed
  const filteredTickers = useMemo(() => {
    const q = tickerInput.trim().toLowerCase();
    if (!q) return tickers.slice(0, 100);
    return tickers.filter(t => t.toLowerCase().startsWith(q)).slice(0, 100);
  }, [tickers, tickerInput]);

  async function run() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const qs = new URLSearchParams({
        ticker: tickerInput.toUpperCase(),
        priceMode,
        ...(expand ? { expand: "1" } : {}),
      });
      const res = await fetch(`/api/report?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `${res.status} ${res.statusText}`);
      }
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Request failed");
    } finally {
      setLoading(false);
    }
  }

  // Kick off an initial run on mount
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1>Report (live Sheets)</h1>

      {/* Controls */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto auto",
          gap: 12,
          alignItems: "end",
          marginBottom: 16,
          maxWidth: 820,
        }}
      >
        {/* Ticker combobox (input + datalist) */}
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#666" }}>Ticker</span>
          <input
            list="ticker-list"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
            }}
            placeholder="Type to filter… (e.g., b → BCO, BGO, …)"
            style={{
              padding: "8px 10px",
              border: "1px solid #ddd",
              borderRadius: 8,
              fontFamily: "inherit",
              fontSize: 14,
            }}
          />
          {/* Dynamic suggestions (startsWith filter) */}
          <datalist id="ticker-list">
            {filteredTickers.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>

        {/* Price mode */}
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#666" }}>Price mode</span>
          <select
            value={priceMode}
            onChange={(e) => setPriceMode(e.target.value as PriceMode)}
            style={{
              padding: "8px 10px",
              border: "1px solid #ddd",
              borderRadius: 8,
              fontFamily: "inherit",
              fontSize: 14,
            }}
          >
            <option value="bid">bid</option>
            <option value="ask">ask</option>
            <option value="pp7">pp7</option>
            <option value="pp30">pp30</option>
          </select>
        </label>

        {/* Expand toggle */}
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#666" }}>Expand children</span>
          <input
            type="checkbox"
            checked={expand}
            onChange={(e) => setExpand(e.target.checked)}
            style={{ width: 20, height: 20, cursor: "pointer" }}
            title="Include child rows in the best option"
          />
        </label>

        <button
          onClick={run}
          disabled={loading}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #0b6",
            background: loading ? "#9dd" : "#0c7",
            color: "white",
            fontWeight: 600,
            cursor: loading ? "default" : "pointer",
            userSelect: "none",
          }}
        >
          {loading ? "Running…" : "Run"}
        </button>
      </div>

      {/* Status line (keeps your nice header) */}
      {data && (
        <p>
          <strong>Ticker:</strong> {data.ticker} &nbsp; | &nbsp;
          <strong>Mode:</strong> {data.priceMode} &nbsp; | &nbsp;
          <strong>Total Options:</strong> {data.totalOptions} &nbsp; | &nbsp;
          <strong>Best P/A:</strong>{" "}
          {data.bestPA != null ? Number(data.bestPA).toFixed(6) : "n/a"}
        </p>
      )}

      {/* Error */}
      {error && (
        <>
          <h2 style={{ color: "#b00" }}>API Error</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>{error}</pre>
        </>
      )}

      {/* Results */}
      {data && !error && (
        <>
          {data.best ? (
            <section style={{ marginTop: 32 }}>
              <h2>Best Scenario Sankey</h2>
              <p style={{ margin: "8px 0 16px", color: "#555", maxWidth: 760 }}>
                Visualizes the best-performing production chain. Each link width
                represents units consumed per day; hover nodes or links for
                profit, area, and sourcing context.
              </p>
              <BestScenarioSankey
                best={data.best}
                ticker={data.ticker}
                priceMode={data.priceMode}
              />
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
                {JSON.stringify(data.best, null, 2)}
              </pre>
            </details>
          </section>

          <section style={{ marginTop: 32 }}>
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                View top 5 options (JSON)
              </summary>
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>
                {JSON.stringify(data.top5, null, 2)}
              </pre>
            </details>
          </section>

          <p style={{ marginTop: 24, color: "#666" }}>
            Tip: try <code>?ticker=XYZ&amp;mode=pp7</code> or toggle <strong>Expand
            children</strong> to include child rows in the best option.
          </p>
        </>
      )}
    </main>
  );
}

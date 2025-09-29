// app/components/ReportClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PriceMode } from "@/types";

const PRICE_MODES: PriceMode[] = ["bid", "ask", "pp7", "pp30"];

type ReportData = any; // keep loose to avoid chasing types here

export default function ReportClient() {
  const router = useRouter();
  const sp = useSearchParams();

  // derive initial state from URL (so links are shareable)
  const initialTicker = (sp.get("ticker") ?? "PCB").toUpperCase();
  const initialMode   = (sp.get("mode") ?? sp.get("priceMode") ?? "bid") as PriceMode;
  const initialExpand = sp.get("expand") === "1";

  const [tickers, setTickers] = useState<string[]>([]);
  const [ticker, setTicker] = useState(initialTicker);
  const [priceMode, setPriceMode] = useState<PriceMode>(initialMode);
  const [expand, setExpand] = useState<boolean>(initialExpand);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // fetch ticker list on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/tickers", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (j?.ok && Array.isArray(j.tickers)) setTickers(j.tickers);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  // keep URL in sync (so “copy link” retains the selection)
  const updateUrl = useMemo(() => {
    return (t: string, m: PriceMode, e: boolean) => {
      const qs = new URLSearchParams();
      qs.set("ticker", t);
      qs.set("mode", m);
      if (e) qs.set("expand", "1");
      router.replace(`/?${qs.toString()}`, { scroll: false });
    };
  }, [router]);

  // fetch the report whenever inputs change
  useEffect(() => {
    setLoading(true);
    setError(null);

    updateUrl(ticker, priceMode, expand);

    const qs = new URLSearchParams({ ticker, priceMode, ...(expand ? { expand: "1" } : {}) });
    fetch(`/api/report?${qs.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const j = await res.json();
        if (!res.ok || j?.ok === false) {
          throw new Error(j?.error || `${res.status} ${res.statusText}`);
        }
        setData(j);
      })
      .catch((err: any) => setError(String(err?.message ?? err)))
      .finally(() => setLoading(false));
  }, [ticker, priceMode, expand, updateUrl]);

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 12 }}>Profitability Report</h1>

      {/* Controls */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto",
          gap: 12,
          alignItems: "end",
          marginBottom: 16,
        }}
      >
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 6 }}>
            Ticker
          </label>
          <select
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #ddd" }}
          >
            {/* show current in case list is still loading or missing */}
            {!tickers.includes(ticker) && <option value={ticker}>{ticker}</option>}
            {tickers.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 6 }}>
            Price Mode
          </label>
          <select
            value={priceMode}
            onChange={(e) => setPriceMode(e.target.value as PriceMode)}
            style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #ddd" }}
          >
            {PRICE_MODES.map((m) => (
              <option key={m} value={m}>{m.toUpperCase()}</option>
            ))}
          </select>
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "center", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={expand}
            onChange={(e) => setExpand(e.target.checked)}
          />
          Expand child rows
        </label>
      </div>

      {/* Status / Summary */}
      {loading && <p style={{ color: "#666" }}>Loading…</p>}
      {error && (
        <>
          <h2 style={{ color: "#b00" }}>API Error</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>{error}</pre>
        </>
      )}

      {data && !error && (
        <>
          <p style={{ marginBottom: 16 }}>
            <strong>Ticker:</strong> {data.ticker} &nbsp; | &nbsp;
            <strong>Mode:</strong> {data.priceMode} &nbsp; | &nbsp;
            <strong>Total Options:</strong> {data.totalOptions} &nbsp; | &nbsp;
            <strong>Best P/A:</strong>{" "}
            {data.bestPA != null ? Number(data.bestPA).toFixed(6) : "n/a"}
          </p>

          <section style={{ marginTop: 8 }}>
            <h2>Best Scenario (full object)</h2>
            <pre style={{ whiteSpace: "pre-wrap", background: "#fafafa", padding: 12, border: "1px solid #eee", borderRadius: 6 }}>
              {JSON.stringify(data.best, null, 2)}
            </pre>
          </section>

          <section style={{ marginTop: 8 }}>
            <h2>Top 5 (summary only)</h2>
            <pre style={{ whiteSpace: "pre-wrap", background: "#fafafa", padding: 12, border: "1px solid #eee", borderRadius: 6 }}>
              {JSON.stringify(data.top5, null, 2)}
            </pre>
          </section>

          <p style={{ marginTop: 16, color: "#666" }}>
            Tip: try <code>?ticker=XYZ&amp;mode=pp7</code> or add{" "}
            <code>&amp;expand=1</code> to include child rows in the best option.
          </p>
        </>
      )}
    </main>
  );
}

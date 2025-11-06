"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { Exchange } from "@/types";
import { formatProfitPerArea } from "@/lib/formatting";

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface MoverResult {
  ticker: string;
  currentProfitPA: number;
  previousProfitPA: number | null;
  absoluteChange: number;
  percentChange: number;
  recipeChanged: boolean;
  currentRecipeId: string | null;
  previousRecipeId: string | null;
}

interface MoversResponse {
  success: boolean;
  period?: string;
  exchange?: string;
  sellAt?: string;
  comparisonTimestamps?: {
    current: string;
    previous: string;
  };
  movers?: MoverResult[];
  count?: number;
  error?: string;
}

interface HistoricalSnapshot {
  timestamp: string;
  recipeId: string | null;
  scenario: string;
  profitPA: number;
  buyAllProfitPA: number | null;
  building?: string | null;
  changeFromPrevious?: number;
  percentChange?: number;
}

interface HistoryResponse {
  success: boolean;
  ticker?: string;
  exchange?: string;
  sellAt?: string;
  history?: HistoricalSnapshot[];
  count?: number;
  error?: string;
}

const EXCHANGE_OPTIONS = [
  { display: "ANT", value: "ANT" },
  { display: "CIS", value: "CIS" },
  { display: "ICA", value: "ICA" },
  { display: "NCC", value: "NCC" },
];

const SELL_AT_OPTIONS = [
  { display: "Bid", value: "bid" },
  { display: "Ask", value: "ask" },
  { display: "PP7", value: "pp7" },
];

const PERIOD_OPTIONS = [
  { display: "1 Day", value: "1d" },
  { display: "7 Days", value: "7d" },
  { display: "30 Days", value: "30d" },
];

export default function BestRecipesHistoryClient() {
  // Movers state
  const [moversLoading, setMoversLoading] = useState(false);
  const [moversData, setMoversData] = useState<MoverResult[]>([]);
  const [moversError, setMoversError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>("1d");
  const [exchange, setExchange] = useState<string>("ANT");
  const [sellAt, setSellAt] = useState<string>("bid");
  const [comparisonTimestamps, setComparisonTimestamps] = useState<{
    current: string;
    previous: string;
  } | null>(null);

  // History state
  const [selectedTicker, setSelectedTicker] = useState<string>("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState<HistoricalSnapshot[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Load movers data
  const loadMovers = async () => {
    setMoversLoading(true);
    setMoversError(null);
    try {
      const qs = new URLSearchParams({ period, exchange, sellAt });
      const res = await fetch(`/api/best-recipes/movers?${qs.toString()}`, {
        cache: "no-store",
      });

      const json: MoversResponse = await res.json();

      if (!json.success) {
        setMoversError(json.error || "Failed to load movers data");
        setMoversData([]);
        setComparisonTimestamps(null);
        return;
      }

      setMoversData(json.movers || []);
      setComparisonTimestamps(json.comparisonTimestamps || null);
    } catch (err: any) {
      setMoversError(err.message || "Failed to load movers data");
      setMoversData([]);
      setComparisonTimestamps(null);
    } finally {
      setMoversLoading(false);
    }
  };

  // Load history data for selected ticker
  const loadHistory = async (ticker: string) => {
    if (!ticker) return;

    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const qs = new URLSearchParams({ ticker, exchange, sellAt, limit: "100" });
      const res = await fetch(`/api/best-recipes/history?${qs.toString()}`, {
        cache: "no-store",
      });

      const json: HistoryResponse = await res.json();

      if (!json.success) {
        setHistoryError(json.error || "Failed to load history data");
        setHistoryData([]);
        return;
      }

      setHistoryData(json.history || []);
    } catch (err: any) {
      setHistoryError(err.message || "Failed to load history data");
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Load movers on mount and when parameters change
  useEffect(() => {
    loadMovers();
  }, [period, exchange, sellAt]);

  // Load history when ticker is selected
  useEffect(() => {
    if (selectedTicker) {
      loadHistory(selectedTicker);
    } else {
      setHistoryData([]);
      setHistoryError(null);
    }
  }, [selectedTicker, exchange, sellAt]);

  const handleTickerClick = (ticker: string) => {
    setSelectedTicker(ticker);
    // Scroll to history section
    setTimeout(() => {
      document.getElementById("ticker-history")?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatChange = (change: number) => {
    const sign = change >= 0 ? "+" : "";
    return `${sign}${change.toFixed(2)}`;
  };

  const formatPercent = (percent: number) => {
    const sign = percent >= 0 ? "+" : "";
    return `${sign}${percent.toFixed(2)}%`;
  };

  // Calculate stats for history
  const historyStats = historyData.length > 0 ? {
    current: historyData[historyData.length - 1].profitPA,
    oldest: historyData[0].profitPA,
    max: Math.max(...historyData.map(h => h.profitPA)),
    min: Math.min(...historyData.map(h => h.profitPA)),
    avg: historyData.reduce((sum, h) => sum + h.profitPA, 0) / historyData.length,
    recipeChanges: historyData.filter((h, i) =>
      i > 0 && h.recipeId !== historyData[i - 1].recipeId
    ).length,
  } : null;

  return (
    <div style={{ padding: "20px", maxWidth: "1600px", margin: "0 auto" }}>
      <h1 style={{ color: "#ff8c00", marginBottom: "10px" }}>Best Recipes Historical Analysis</h1>
      <p style={{ color: "#ccc", marginBottom: "30px" }}>
        Track profitability changes over time and identify the biggest movers in the market.
      </p>

      {/* Movers Section */}
      <section style={{ marginBottom: "50px" }}>
        <h2 style={{ color: "#ff8c00", marginBottom: "15px" }}>
          Biggest Movers - Top Profit/Loss Changes
        </h2>

        {/* Controls */}
        <div style={{ display: "flex", gap: "15px", marginBottom: "20px", flexWrap: "wrap" }}>
          <div>
            <label style={{ display: "block", marginBottom: "5px", color: "#ccc" }}>
              Period:
            </label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              style={{
                padding: "8px",
                backgroundColor: "#1a1a1a",
                color: "#ff8c00",
                border: "1px solid #ff8c00",
              }}
            >
              {PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.display}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "5px", color: "#ccc" }}>
              Exchange:
            </label>
            <select
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
              style={{
                padding: "8px",
                backgroundColor: "#1a1a1a",
                color: "#ff8c00",
                border: "1px solid #ff8c00",
              }}
            >
              {EXCHANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.display}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "5px", color: "#ccc" }}>
              Sell At:
            </label>
            <select
              value={sellAt}
              onChange={(e) => setSellAt(e.target.value)}
              style={{
                padding: "8px",
                backgroundColor: "#1a1a1a",
                color: "#ff8c00",
                border: "1px solid #ff8c00",
              }}
            >
              {SELL_AT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.display}
                </option>
              ))}
            </select>
          </div>
        </div>

        {comparisonTimestamps && (
          <p style={{ color: "#888", fontSize: "14px", marginBottom: "15px" }}>
            Comparing {formatTimestamp(comparisonTimestamps.current)} with{" "}
            {formatTimestamp(comparisonTimestamps.previous)}
          </p>
        )}

        {/* Movers Table */}
        {moversLoading ? (
          <p style={{ color: "#ccc" }}>Loading movers data...</p>
        ) : moversError ? (
          <p style={{ color: "#ff4444" }}>Error: {moversError}</p>
        ) : moversData.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                backgroundColor: "#1a1a1a",
                color: "#ccc",
              }}
            >
              <thead>
                <tr style={{ backgroundColor: "#222", color: "#ff8c00" }}>
                  <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #ff8c00" }}>
                    Ticker
                  </th>
                  <th style={{ padding: "10px", textAlign: "right", borderBottom: "2px solid #ff8c00" }}>
                    Current P/A
                  </th>
                  <th style={{ padding: "10px", textAlign: "right", borderBottom: "2px solid #ff8c00" }}>
                    Previous P/A
                  </th>
                  <th style={{ padding: "10px", textAlign: "right", borderBottom: "2px solid #ff8c00" }}>
                    Change
                  </th>
                  <th style={{ padding: "10px", textAlign: "right", borderBottom: "2px solid #ff8c00" }}>
                    % Change
                  </th>
                  <th style={{ padding: "10px", textAlign: "center", borderBottom: "2px solid #ff8c00" }}>
                    Recipe Changed
                  </th>
                </tr>
              </thead>
              <tbody>
                {moversData.map((mover, idx) => (
                  <tr
                    key={`${mover.ticker}-${idx}`}
                    style={{
                      borderBottom: "1px solid #333",
                      cursor: "pointer",
                      backgroundColor: selectedTicker === mover.ticker ? "#2a2a2a" : "transparent",
                    }}
                    onClick={() => handleTickerClick(mover.ticker)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "#2a2a2a";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor =
                        selectedTicker === mover.ticker ? "#2a2a2a" : "transparent";
                    }}
                  >
                    <td style={{ padding: "10px", fontWeight: "bold", color: "#ff8c00" }}>
                      {mover.ticker}
                    </td>
                    <td style={{ padding: "10px", textAlign: "right" }}>
                      {formatProfitPerArea(mover.currentProfitPA, exchange as Exchange)}
                    </td>
                    <td style={{ padding: "10px", textAlign: "right" }}>
                      {mover.previousProfitPA !== null
                        ? formatProfitPerArea(mover.previousProfitPA, exchange as Exchange)
                        : "N/A"}
                    </td>
                    <td
                      style={{
                        padding: "10px",
                        textAlign: "right",
                        color: mover.absoluteChange >= 0 ? "#4ade80" : "#f87171",
                      }}
                    >
                      {formatChange(mover.absoluteChange)}
                    </td>
                    <td
                      style={{
                        padding: "10px",
                        textAlign: "right",
                        fontWeight: "bold",
                        color: mover.percentChange >= 0 ? "#4ade80" : "#f87171",
                      }}
                    >
                      {formatPercent(mover.percentChange)}
                    </td>
                    <td
                      style={{
                        padding: "10px",
                        textAlign: "center",
                        color: mover.recipeChanged ? "#ff8c00" : "#666",
                      }}
                    >
                      {mover.recipeChanged ? "Yes" : "No"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: "#888" }}>No movers data available.</p>
        )}
      </section>

      {/* Ticker History Section */}
      <section id="ticker-history">
        <h2 style={{ color: "#ff8c00", marginBottom: "15px" }}>
          Ticker Deep Dive{selectedTicker ? `: ${selectedTicker}` : ""}
        </h2>

        {!selectedTicker ? (
          <p style={{ color: "#888" }}>
            Click on a ticker from the movers table above to view its historical data.
          </p>
        ) : historyLoading ? (
          <p style={{ color: "#ccc" }}>Loading history for {selectedTicker}...</p>
        ) : historyError ? (
          <p style={{ color: "#ff4444" }}>Error: {historyError}</p>
        ) : historyData.length > 0 ? (
          <>
            {/* Stats Box */}
            {historyStats && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: "15px",
                  marginBottom: "25px",
                  padding: "20px",
                  backgroundColor: "#1a1a1a",
                  border: "1px solid #ff8c00",
                }}
              >
                <div>
                  <div style={{ color: "#888", fontSize: "12px" }}>Current P/A</div>
                  <div style={{ color: "#ff8c00", fontSize: "18px", fontWeight: "bold" }}>
                    {formatProfitPerArea(historyStats.current, exchange as Exchange)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#888", fontSize: "12px" }}>Change Since Start</div>
                  <div
                    style={{
                      fontSize: "18px",
                      fontWeight: "bold",
                      color: historyStats.current - historyStats.oldest >= 0 ? "#4ade80" : "#f87171",
                    }}
                  >
                    {formatChange(historyStats.current - historyStats.oldest)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#888", fontSize: "12px" }}>Average P/A</div>
                  <div style={{ color: "#ccc", fontSize: "18px", fontWeight: "bold" }}>
                    {formatProfitPerArea(historyStats.avg, exchange as Exchange)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#888", fontSize: "12px" }}>Max P/A</div>
                  <div style={{ color: "#4ade80", fontSize: "18px", fontWeight: "bold" }}>
                    {formatProfitPerArea(historyStats.max, exchange as Exchange)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#888", fontSize: "12px" }}>Min P/A</div>
                  <div style={{ color: "#f87171", fontSize: "18px", fontWeight: "bold" }}>
                    {formatProfitPerArea(historyStats.min, exchange as Exchange)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#888", fontSize: "12px" }}>Recipe Changes</div>
                  <div style={{ color: "#ff8c00", fontSize: "18px", fontWeight: "bold" }}>
                    {historyStats.recipeChanges}
                  </div>
                </div>
              </div>
            )}

            {/* Chart */}
            <div style={{ marginBottom: "25px" }}>
              <Plot
                data={[
                  {
                    x: historyData.map((h) => h.timestamp),
                    y: historyData.map((h) => h.profitPA),
                    type: "scatter",
                    mode: "lines+markers",
                    marker: { color: "#ff8c00", size: 6 },
                    line: { color: "#ff8c00", width: 2 },
                    name: "Profit P/A",
                  },
                ]}
                layout={{
                  paper_bgcolor: "#1a1a1a",
                  plot_bgcolor: "#1a1a1a",
                  font: { color: "#ccc" },
                  xaxis: {
                    title: "Timestamp",
                    gridcolor: "#333",
                    color: "#ccc",
                  },
                  yaxis: {
                    title: "Profit per Area (P/A)",
                    gridcolor: "#333",
                    color: "#ccc",
                  },
                  margin: { l: 60, r: 40, t: 40, b: 80 },
                  hovermode: "closest",
                }}
                config={{ responsive: true }}
                style={{ width: "100%", height: "400px" }}
              />
            </div>

            {/* History Table */}
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  backgroundColor: "#1a1a1a",
                  color: "#ccc",
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: "#222", color: "#ff8c00" }}>
                    <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #ff8c00" }}>
                      Timestamp
                    </th>
                    <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #ff8c00" }}>
                      Recipe ID
                    </th>
                    <th style={{ padding: "10px", textAlign: "right", borderBottom: "2px solid #ff8c00" }}>
                      Profit P/A
                    </th>
                    <th style={{ padding: "10px", textAlign: "right", borderBottom: "2px solid #ff8c00" }}>
                      Change
                    </th>
                    <th style={{ padding: "10px", textAlign: "right", borderBottom: "2px solid #ff8c00" }}>
                      % Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {historyData.map((snapshot, idx) => (
                    <tr key={`${snapshot.timestamp}-${idx}`} style={{ borderBottom: "1px solid #333" }}>
                      <td style={{ padding: "10px", fontSize: "12px" }}>
                        {formatTimestamp(snapshot.timestamp)}
                      </td>
                      <td style={{ padding: "10px", fontFamily: "monospace", fontSize: "12px" }}>
                        {snapshot.recipeId || "BUY"}
                      </td>
                      <td style={{ padding: "10px", textAlign: "right" }}>
                        {formatProfitPerArea(snapshot.profitPA, exchange as Exchange)}
                      </td>
                      <td
                        style={{
                          padding: "10px",
                          textAlign: "right",
                          color:
                            snapshot.changeFromPrevious === undefined
                              ? "#666"
                              : snapshot.changeFromPrevious >= 0
                              ? "#4ade80"
                              : "#f87171",
                        }}
                      >
                        {snapshot.changeFromPrevious !== undefined
                          ? formatChange(snapshot.changeFromPrevious)
                          : "-"}
                      </td>
                      <td
                        style={{
                          padding: "10px",
                          textAlign: "right",
                          color:
                            snapshot.percentChange === undefined
                              ? "#666"
                              : snapshot.percentChange >= 0
                              ? "#4ade80"
                              : "#f87171",
                        }}
                      >
                        {snapshot.percentChange !== undefined ? formatPercent(snapshot.percentChange) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

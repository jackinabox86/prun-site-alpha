"use client";

import { useState, useEffect, useCallback } from "react";
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
  currentBuyAllProfitPA: number | null;
  previousBuyAllProfitPA: number | null;
  buyAllAbsoluteChange: number | null;
  buyAllPercentChange: number | null;
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
  buyAllChangeFromPrevious?: number;
  buyAllPercentChange?: number;
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

  // Sorting state for movers table
  const [sortColumn, setSortColumn] = useState<keyof MoverResult>("absoluteChange");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // History state
  const [selectedTicker, setSelectedTicker] = useState<string>("");
  const [tickerInput, setTickerInput] = useState<string>("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState<HistoricalSnapshot[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Load movers data
  const loadMovers = useCallback(async () => {
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
  }, [period, exchange, sellAt]);

  // Load history data for selected ticker
  const loadHistory = useCallback(async (ticker: string) => {
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
  }, [exchange, sellAt]);

  // Load movers on mount and when parameters change
  useEffect(() => {
    loadMovers();
  }, [loadMovers]);

  // Load history when ticker is selected
  useEffect(() => {
    if (selectedTicker) {
      loadHistory(selectedTicker);
    } else {
      setHistoryData([]);
      setHistoryError(null);
    }
  }, [selectedTicker, loadHistory]);

  const handleTickerClick = (ticker: string) => {
    setSelectedTicker(ticker);
    // Scroll to history section
    setTimeout(() => {
      document.getElementById("ticker-history")?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  const handleTickerJump = (e: React.FormEvent) => {
    e.preventDefault();
    const ticker = tickerInput.trim().toUpperCase();
    if (ticker) {
      setSelectedTicker(ticker);
      setTickerInput("");
      // Scroll to history section
      setTimeout(() => {
        document.getElementById("ticker-history")?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  };

  // Handle sorting
  const handleSort = (column: keyof MoverResult) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // New column, default to descending for numeric columns
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  // Parse timestamp that may have hyphens instead of colons
  const parseTimestamp = (timestamp: string) => {
    // Convert "2025-11-07T20-01-54Z" to "2025-11-07T20:01:54Z"
    const malformedPattern = /^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})(Z)$/;
    const match = timestamp.match(malformedPattern);
    if (match) {
      const properTimestamp = `${match[1]}${match[2]}:${match[3]}:${match[4]}${match[5]}`;
      return new Date(properTimestamp);
    }
    return new Date(timestamp);
  };

  const formatTimestamp = (timestamp: string) => {
    const date = parseTimestamp(timestamp);
    return date.toLocaleString();
  };

  const formatChange = (change: number) => {
    const sign = change >= 0 ? "+" : "";
    return `${sign}${change.toFixed(1)}`;
  };

  const formatPercent = (percent: number) => {
    const sign = percent >= 0 ? "+" : "";
    return `${sign}${percent.toFixed(1)}%`;
  };

  // Filter and sort movers data
  const filteredMovers = moversData.filter((mover) => {
    // Filter out boring entries:
    // 1. For positive changes: exclude if both previous and current P/A are negative
    if (mover.absoluteChange > 0) {
      if (mover.previousProfitPA !== null && mover.previousProfitPA < 0 && mover.currentProfitPA < 0) {
        return false; // Boring: went from negative to still negative (even if slightly less negative)
      }
    }
    // 2. For negative changes: exclude if previous was negative and current is even more negative
    else if (mover.absoluteChange < 0) {
      if (mover.previousProfitPA !== null && mover.previousProfitPA < 0 && mover.currentProfitPA < mover.previousProfitPA) {
        return false; // Boring: went from negative to more negative
      }
    }
    return true;
  });

  const sortedMovers = [...filteredMovers].sort((a, b) => {
    const aVal = a[sortColumn];
    const bVal = b[sortColumn];

    // Handle null values
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;

    // Compare values
    let comparison = 0;
    if (typeof aVal === "number" && typeof bVal === "number") {
      comparison = aVal - bVal;
    } else if (typeof aVal === "string" && typeof bVal === "string") {
      comparison = aVal.localeCompare(bVal);
    } else if (typeof aVal === "boolean" && typeof bVal === "boolean") {
      comparison = (aVal === bVal) ? 0 : aVal ? 1 : -1;
    }

    return sortDirection === "asc" ? comparison : -comparison;
  });

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
    <div className="terminal-container">
      {/* Header Section */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <h1 className="terminal-header" style={{ fontSize: "1.2rem" }}>
          BEST RECIPES // HISTORICAL ANALYSIS
        </h1>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "0.875rem", lineHeight: "1.6" }}>
          This page tracks historical changes in best recipe profitability across all tickers.
          The <strong style={{ color: "var(--color-accent-primary)" }}>Biggest Movers</strong> table below shows which tickers have experienced the largest profit changes over your selected time period.
          You can sort the table by clicking any column header.
          To view detailed historical data for a specific ticker, simply <strong style={{ color: "var(--color-accent-primary)" }}>click on a ticker name</strong> in the table,
          or use the "Jump to Deep Dive" input to search directly.
        </p>
      </div>

      {/* Movers Section */}
      <section className="terminal-box" style={{ marginBottom: "2rem" }}>
        <h2 className="terminal-header">
          BIGGEST MOVERS // TOP PROFIT/LOSS CHANGES
        </h2>

        {/* Controls */}
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--color-text-secondary)", fontSize: "0.875rem", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>
              Period:
            </label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="terminal-select"
            >
              {PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.display}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--color-text-secondary)", fontSize: "0.875rem", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>
              Exchange:
            </label>
            <select
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
              className="terminal-select"
            >
              {EXCHANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.display}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--color-text-secondary)", fontSize: "0.875rem", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>
              Sell At:
            </label>
            <select
              value={sellAt}
              onChange={(e) => setSellAt(e.target.value)}
              className="terminal-select"
            >
              {SELL_AT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.display}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginLeft: "auto" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--color-text-secondary)", fontSize: "0.875rem", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>
              Jump to Deep Dive:
            </label>
            <form onSubmit={handleTickerJump} style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                placeholder="Ticker..."
                className="terminal-input"
                style={{ width: "120px" }}
              />
              <button type="submit" className="terminal-button">
                GO
              </button>
            </form>
          </div>
        </div>

        {comparisonTimestamps && (
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.875rem", marginBottom: "1rem", fontFamily: "var(--font-mono)" }}>
            Comparing {formatTimestamp(comparisonTimestamps.current)} with{" "}
            {formatTimestamp(comparisonTimestamps.previous)}
          </p>
        )}

        {/* Movers Table */}
        {moversLoading ? (
          <p className="terminal-loading" style={{ color: "var(--color-text-primary)" }}>Loading movers data</p>
        ) : moversError ? (
          <p className="status-error">Error: {moversError}</p>
        ) : moversData.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="terminal-table">
              <thead>
                <tr>
                  <th
                    onClick={() => handleSort("ticker")}
                    style={{ cursor: "pointer", userSelect: "none" }}>
                    Ticker {sortColumn === "ticker" && (sortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleSort("currentProfitPA")}
                    style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}>
                    Current P/A {sortColumn === "currentProfitPA" && (sortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleSort("previousProfitPA")}
                    style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}>
                    Previous P/A {sortColumn === "previousProfitPA" && (sortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleSort("absoluteChange")}
                    style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}>
                    Change {sortColumn === "absoluteChange" && (sortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleSort("percentChange")}
                    style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}>
                    % Change {sortColumn === "percentChange" && (sortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleSort("currentBuyAllProfitPA")}
                    style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}>
                    Buy-All P/A {sortColumn === "currentBuyAllProfitPA" && (sortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleSort("buyAllAbsoluteChange")}
                    style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}>
                    Buy-All Change {sortColumn === "buyAllAbsoluteChange" && (sortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleSort("buyAllPercentChange")}
                    style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}>
                    Buy-All % {sortColumn === "buyAllPercentChange" && (sortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleSort("recipeChanged")}
                    style={{ textAlign: "center", cursor: "pointer", userSelect: "none" }}>
                    Recipe Changed {sortColumn === "recipeChanged" && (sortDirection === "asc" ? "▲" : "▼")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedMovers.map((mover, idx) => (
                  <tr
                    key={`${mover.ticker}-${idx}`}
                    style={{ cursor: "pointer" }}
                    onClick={() => handleTickerClick(mover.ticker)}
                  >
                    <td style={{ fontWeight: "bold", color: "var(--color-accent-primary)" }}>
                      {mover.ticker}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {formatProfitPerArea(mover.currentProfitPA, exchange as Exchange)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {mover.previousProfitPA !== null
                        ? formatProfitPerArea(mover.previousProfitPA, exchange as Exchange)
                        : "N/A"}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        color: mover.absoluteChange >= 0 ? "var(--color-success)" : "var(--color-error)",
                      }}
                    >
                      {formatChange(mover.absoluteChange)}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontWeight: "bold",
                        color: mover.percentChange >= 0 ? "var(--color-success)" : "var(--color-error)",
                      }}
                    >
                      {formatPercent(mover.percentChange)}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--color-text-muted)" }}>
                      {mover.currentBuyAllProfitPA !== null
                        ? formatProfitPerArea(mover.currentBuyAllProfitPA, exchange as Exchange)
                        : "N/A"}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        color: mover.buyAllAbsoluteChange !== null
                          ? mover.buyAllAbsoluteChange >= 0 ? "var(--color-success)" : "var(--color-error)"
                          : "var(--color-text-muted)",
                      }}
                    >
                      {mover.buyAllAbsoluteChange !== null
                        ? formatChange(mover.buyAllAbsoluteChange)
                        : "N/A"}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        color: mover.buyAllPercentChange !== null
                          ? mover.buyAllPercentChange >= 0 ? "var(--color-success)" : "var(--color-error)"
                          : "var(--color-text-muted)",
                      }}
                    >
                      {mover.buyAllPercentChange !== null
                        ? formatPercent(mover.buyAllPercentChange)
                        : "N/A"}
                    </td>
                    <td
                      style={{
                        textAlign: "center",
                        color: mover.recipeChanged ? "var(--color-accent-primary)" : "var(--color-text-muted)",
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
          <p style={{ color: "var(--color-text-secondary)" }}>No movers data available.</p>
        )}
      </section>

      {/* Ticker History Section */}
      <section id="ticker-history" className="terminal-box" style={{ marginBottom: "2rem" }}>
        <h2 className="terminal-header">
          Ticker Deep Dive{selectedTicker ? `: ${selectedTicker}` : ""}
        </h2>

        {!selectedTicker ? (
          <p style={{ color: "var(--color-text-secondary)" }}>
            Click on a ticker from the movers table above to view its historical data.
          </p>
        ) : historyLoading ? (
          <p className="terminal-loading" style={{ color: "var(--color-text-primary)" }}>Loading history for {selectedTicker}</p>
        ) : historyError ? (
          <p className="status-error">Error: {historyError}</p>
        ) : historyData.length > 0 ? (
          <>
            {/* Stats Box */}
            {historyStats && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: "1rem",
                  marginBottom: "1.5rem",
                  padding: "1.25rem",
                  backgroundColor: "var(--color-bg-tertiary)",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "4px",
                }}
              >
                <div>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>Current P/A</div>
                  <div style={{ color: "var(--color-accent-primary)", fontSize: "1.125rem", fontWeight: "bold" }}>
                    {formatProfitPerArea(historyStats.current, exchange as Exchange)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>Change Since Start</div>
                  <div
                    style={{
                      fontSize: "1.125rem",
                      fontWeight: "bold",
                      color: historyStats.current - historyStats.oldest >= 0 ? "var(--color-success)" : "var(--color-error)",
                    }}
                  >
                    {formatChange(historyStats.current - historyStats.oldest)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>Average P/A</div>
                  <div style={{ color: "var(--color-text-primary)", fontSize: "1.125rem", fontWeight: "bold" }}>
                    {formatProfitPerArea(historyStats.avg, exchange as Exchange)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>Max P/A</div>
                  <div style={{ color: "var(--color-success)", fontSize: "1.125rem", fontWeight: "bold" }}>
                    {formatProfitPerArea(historyStats.max, exchange as Exchange)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>Min P/A</div>
                  <div style={{ color: "var(--color-error)", fontSize: "1.125rem", fontWeight: "bold" }}>
                    {formatProfitPerArea(historyStats.min, exchange as Exchange)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>Recipe Changes</div>
                  <div style={{ color: "var(--color-accent-primary)", fontSize: "1.125rem", fontWeight: "bold" }}>
                    {historyStats.recipeChanges}
                  </div>
                </div>
              </div>
            )}

            {/* Chart */}
            <div style={{ marginBottom: "1.5rem" }}>
              <Plot
                data={[
                  {
                    x: historyData.map((h) => h.timestamp),
                    y: historyData.map((h) => h.profitPA),
                    type: "scatter",
                    mode: "lines+markers",
                    marker: { color: "rgb(255, 149, 0)", size: 6 },
                    line: { color: "rgb(255, 149, 0)", width: 2 },
                    name: "Profit P/A",
                  },
                ]}
                layout={{
                  paper_bgcolor: "rgb(16, 20, 25)",
                  plot_bgcolor: "rgb(16, 20, 25)",
                  font: { color: "rgb(230, 232, 235)" },
                  xaxis: {
                    title: "Timestamp",
                    gridcolor: "rgb(42, 63, 95)",
                    color: "rgb(230, 232, 235)",
                  },
                  yaxis: {
                    title: "Profit per Area (P/A)",
                    gridcolor: "rgb(42, 63, 95)",
                    color: "rgb(230, 232, 235)",
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
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Recipe ID</th>
                    <th style={{ textAlign: "right" }}>Profit P/A</th>
                    <th style={{ textAlign: "right" }}>Change</th>
                    <th style={{ textAlign: "right" }}>% Change</th>
                    <th style={{ textAlign: "right" }}>Buy-All P/A</th>
                    <th style={{ textAlign: "right" }}>Buy-All Change</th>
                    <th style={{ textAlign: "right" }}>Buy-All %</th>
                  </tr>
                </thead>
                <tbody>
                  {historyData.map((snapshot, idx) => (
                    <tr key={`${snapshot.timestamp}-${idx}`}>
                      <td style={{ fontSize: "0.75rem" }}>
                        {formatTimestamp(snapshot.timestamp)}
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                        {snapshot.recipeId || "BUY"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {formatProfitPerArea(snapshot.profitPA, exchange as Exchange)}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color:
                            snapshot.changeFromPrevious === undefined
                              ? "var(--color-text-muted)"
                              : snapshot.changeFromPrevious >= 0
                              ? "var(--color-success)"
                              : "var(--color-error)",
                        }}
                      >
                        {snapshot.changeFromPrevious !== undefined
                          ? formatChange(snapshot.changeFromPrevious)
                          : "-"}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color:
                            snapshot.percentChange === undefined
                              ? "var(--color-text-muted)"
                              : snapshot.percentChange >= 0
                              ? "var(--color-success)"
                              : "var(--color-error)",
                        }}
                      >
                        {snapshot.percentChange !== undefined ? formatPercent(snapshot.percentChange) : "-"}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--color-text-muted)" }}>
                        {snapshot.buyAllProfitPA !== null
                          ? formatProfitPerArea(snapshot.buyAllProfitPA, exchange as Exchange)
                          : "N/A"}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color:
                            snapshot.buyAllChangeFromPrevious === undefined
                              ? "var(--color-text-muted)"
                              : snapshot.buyAllChangeFromPrevious >= 0
                              ? "var(--color-success)"
                              : "var(--color-error)",
                        }}
                      >
                        {snapshot.buyAllChangeFromPrevious !== undefined
                          ? formatChange(snapshot.buyAllChangeFromPrevious)
                          : "-"}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color:
                            snapshot.buyAllPercentChange === undefined
                              ? "var(--color-text-muted)"
                              : snapshot.buyAllPercentChange >= 0
                              ? "var(--color-success)"
                              : "var(--color-error)",
                        }}
                      >
                        {snapshot.buyAllPercentChange !== undefined
                          ? formatPercent(snapshot.buyAllPercentChange)
                          : "-"}
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

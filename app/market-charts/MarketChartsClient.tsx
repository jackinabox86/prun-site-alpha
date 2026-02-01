"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface ChartDataPoint {
  date: string;
  timestamp: number;
  open: number | null;
  close: number | null;
  high: number | null;
  low: number | null;
  volume: number;
  traded: number;
  vwap7d: number | null;
}

interface ExchangeChartData {
  exchange: string;
  exchangeName: string;
  ticker: string;
  found: boolean;
  dataPoints: number;
  data: ChartDataPoint[];
}

interface ApiResponse {
  success: boolean;
  ticker: string;
  exchanges: ExchangeChartData[];
  error?: string;
}

// Popular tickers for quick selection
const POPULAR_TICKERS = [
  "RAT", "DW", "COF", "PWO", "FE", "AL", "C", "H2O", "O", "N",
  "PE", "PG", "HMS", "REP", "EXO", "MED", "FIM", "GRN", "HCP"
];

// Exchange colors
const EXCHANGE_COLORS: Record<string, { primary: string; secondary: string; volume: string }> = {
  ANT: { primary: "#ff7b3d", secondary: "#ff9f6d", volume: "rgba(255, 123, 61, 0.5)" },
  CIS: { primary: "#ff1744", secondary: "#ff5a72", volume: "rgba(255, 23, 68, 0.5)" },
  ICA: { primary: "#00cc66", secondary: "#33e085", volume: "rgba(0, 204, 102, 0.5)" },
  NCC: { primary: "#ffdd66", secondary: "#ffe999", volume: "rgba(255, 221, 102, 0.5)" },
};

export default function MarketChartsClient() {
  const [ticker, setTicker] = useState<string>("RAT");
  const [inputValue, setInputValue] = useState<string>("RAT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchangeData, setExchangeData] = useState<ExchangeChartData[]>([]);
  const [showVolume, setShowVolume] = useState(true);
  const [showVwap, setShowVwap] = useState(true);

  const fetchData = useCallback(async (tickerSymbol: string) => {
    if (!tickerSymbol) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/market-charts?ticker=${tickerSymbol}`);
      const data: ApiResponse = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || `Failed to fetch data for ${tickerSymbol}`);
        setExchangeData([]);
        return;
      }

      setExchangeData(data.exchanges);
      setTicker(tickerSymbol);
    } catch (err: any) {
      setError(err.message || "An error occurred");
      setExchangeData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load default ticker on mount
  useEffect(() => {
    fetchData("RAT");
  }, [fetchData]);

  const handleSearch = () => {
    const searchTicker = inputValue.trim().toUpperCase();
    if (searchTicker) {
      fetchData(searchTicker);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const handleQuickSelect = (selectedTicker: string) => {
    setInputValue(selectedTicker);
    fetchData(selectedTicker);
  };

  // Calculate cutoff date (10 days before today) for chart display
  const getCutoffDate = () => {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 10);
    cutoff.setUTCHours(0, 0, 0, 0);
    return cutoff.getTime();
  };
  const cutoffTimestamp = getCutoffDate();

  // Build chart for each exchange
  const renderChart = (exchangeInfo: ExchangeChartData) => {
    if (!exchangeInfo.found || exchangeInfo.data.length === 0) {
      return (
        <div className="terminal-box" key={exchangeInfo.exchange} style={{ marginBottom: "1.5rem" }}>
          <div className="terminal-header" style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>
            {exchangeInfo.ticker}.{exchangeInfo.exchange} - {exchangeInfo.exchangeName}
          </div>
          <div className="text-mono" style={{ color: "var(--color-text-muted)", textAlign: "center", padding: "2rem" }}>
            No market data available for {exchangeInfo.ticker}.{exchangeInfo.exchange}
          </div>
        </div>
      );
    }

    const colors = EXCHANGE_COLORS[exchangeInfo.exchange] || EXCHANGE_COLORS.ANT;

    // Filter data to only include points up to 10 days before today
    const filteredData = exchangeInfo.data.filter((d) => d.timestamp <= cutoffTimestamp);

    // Filter for days with actual trading (non-zero open/close)
    const tradingDays = filteredData.filter((d) => d.open !== null && d.close !== null && d.open > 0 && d.close > 0);

    const dates = tradingDays.map((d) => d.date);
    const opens = tradingDays.map((d) => d.open);
    const closes = tradingDays.map((d) => d.close);
    const highs = tradingDays.map((d) => d.high || Math.max(d.open || 0, d.close || 0));
    const lows = tradingDays.map((d) => d.low || Math.min(d.open || 0, d.close || 0));
    const volumes = tradingDays.map((d) => d.volume);

    // VWAP data (use all filtered data points where vwap7d exists)
    const vwapData = filteredData.filter((d) => d.vwap7d !== null);
    const vwapDates = vwapData.map((d) => d.date);
    const vwap7dValues = vwapData.map((d) => d.vwap7d);

    // Calculate y-axis range for price (with some padding)
    const allPrices = [...opens.filter(Boolean), ...closes.filter(Boolean), ...highs.filter(Boolean), ...lows.filter(Boolean), ...vwap7dValues.filter(Boolean)] as number[];
    const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : 0;
    const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : 100;
    const priceRange = maxPrice - minPrice;
    const yMin = Math.max(0, minPrice - priceRange * 0.1);
    const yMax = maxPrice + priceRange * 0.1;

    // Max volume for scaling
    const maxVolume = Math.max(...volumes, 1);

    // Build traces
    const traces: any[] = [];

    // Candlestick trace
    traces.push({
      type: "candlestick",
      x: dates,
      open: opens,
      high: highs,
      low: lows,
      close: closes,
      name: "OHLC",
      increasing: { line: { color: "#00ff88" }, fillcolor: "#00ff88" },
      decreasing: { line: { color: "#ff4466" }, fillcolor: "#ff4466" },
      hoverinfo: "x+text",
      text: tradingDays.map((d) =>
        `O: ${d.open?.toFixed(2) || "N/A"}<br>H: ${d.high?.toFixed(2) || "N/A"}<br>L: ${d.low?.toFixed(2) || "N/A"}<br>C: ${d.close?.toFixed(2) || "N/A"}<br>Vol: ${d.volume.toLocaleString()}`
      ),
      yaxis: "y2",
    });

    // VWAP line
    if (showVwap && vwapDates.length > 0) {
      traces.push({
        type: "scatter",
        mode: "lines",
        x: vwapDates,
        y: vwap7dValues,
        name: "7d VWAP",
        line: {
          color: colors.primary,
          width: 2,
          dash: "solid",
        },
        hovertemplate: "<b>%{x}</b><br>7d VWAP: %{y:.2f}<extra></extra>",
        yaxis: "y2",
      });
    }

    // Volume bars
    if (showVolume) {
      traces.push({
        type: "bar",
        x: dates,
        y: volumes,
        name: "Volume",
        marker: {
          color: tradingDays.map((d) =>
            (d.close || 0) >= (d.open || 0) ? "rgba(0, 255, 136, 0.5)" : "rgba(255, 68, 102, 0.5)"
          ),
        },
        hovertemplate: "<b>%{x}</b><br>Volume: %{y:,.0f}<extra></extra>",
        yaxis: "y",
      });
    }

    const layout: any = {
      title: {
        text: `${exchangeInfo.ticker}.${exchangeInfo.exchange} - ${exchangeInfo.exchangeName}`,
        font: { color: colors.primary, family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif", size: 16 },
      },
      paper_bgcolor: "#0a0e14",
      plot_bgcolor: "#101419",
      font: { color: "#e6e8eb", family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif" },
      xaxis: {
        type: "category",
        gridcolor: "#2a3f5f",
        showgrid: true,
        color: "#a0a8b5",
        rangeslider: { visible: false },
        tickangle: -45,
        nticks: 20,
      },
      yaxis: {
        title: showVolume ? "Volume" : "",
        gridcolor: "#2a3f5f",
        showgrid: true,
        color: "#a0a8b5",
        domain: showVolume ? [0, 0.2] : [0, 0],
        fixedrange: true,
      },
      yaxis2: {
        title: "Price",
        gridcolor: "#2a3f5f",
        showgrid: true,
        color: "#a0a8b5",
        domain: showVolume ? [0.25, 1] : [0, 1],
        range: [yMin, yMax],
        side: "right",
      },
      showlegend: true,
      legend: {
        x: 0,
        y: 1.15,
        orientation: "h",
        bgcolor: "transparent",
        font: { color: "#a0a8b5", size: 11 },
      },
      margin: { l: 50, r: 60, t: 80, b: 80 },
      hovermode: "x unified",
    };

    const config = {
      displayModeBar: true,
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
      displaylogo: false,
      responsive: true,
    };

    return (
      <div className="terminal-box" key={exchangeInfo.exchange} style={{ marginBottom: "1.5rem" }}>
        <Plot
          data={traces}
          layout={layout}
          config={config}
          style={{ width: "100%", height: "450px" }}
          useResizeHandler={true}
        />
      </div>
    );
  };

  return (
    <div>
      {/* Search Controls */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <h1 className="terminal-header" style={{ margin: 0, marginBottom: "1.5rem", fontSize: "1.2rem", paddingBottom: 0, borderBottom: "none", fontWeight: "normal" }}>
          MARKET CHARTS
        </h1>

        <div style={{ display: "grid", gap: "1.5rem" }}>
          {/* Quick Select Tickers */}
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.875rem", fontFamily: "var(--font-display)", color: "var(--color-text-primary)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>
              Popular:
            </span>
            {POPULAR_TICKERS.map((t) => (
              <button
                key={t}
                className="terminal-button"
                onClick={() => handleQuickSelect(t)}
                style={{
                  fontSize: "0.7rem",
                  padding: "0.3rem 0.5rem",
                  backgroundColor: ticker === t ? "var(--color-accent-primary)" : undefined,
                  color: ticker === t ? "var(--color-bg-primary)" : undefined,
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Ticker Search */}
          <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "150px" }}>
              <label className="terminal-header" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
                Ticker Symbol
              </label>
              <input
                type="text"
                className="terminal-input"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value.toUpperCase())}
                onKeyPress={handleKeyPress}
                placeholder="e.g., RAT, DW, FE"
                style={{ width: "100%" }}
              />
            </div>
            <button
              className="terminal-button"
              onClick={handleSearch}
              disabled={loading}
              style={{ padding: "0.75rem 2rem" }}
            >
              {loading ? "Loading..." : "Load Charts"}
            </button>
          </div>

          {/* Display Options */}
          <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showVwap}
                onChange={(e) => setShowVwap(e.target.checked)}
              />
              <span className="text-mono" style={{ fontSize: "0.875rem" }}>Show 7-Day VWAP</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showVolume}
                onChange={(e) => setShowVolume(e.target.checked)}
              />
              <span className="text-mono" style={{ fontSize: "0.875rem" }}>Show Volume</span>
            </label>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="terminal-box" style={{ marginBottom: "2rem", borderColor: "var(--color-error)" }}>
          <div className="status-error">Warning: {error}</div>
        </div>
      )}

      {/* Info Banner */}
      {ticker && exchangeData.length > 0 && !error && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.875rem" }}>
            <span className="text-accent" style={{ fontFamily: "var(--font-mono)" }}>
              Showing: {ticker}
            </span>
            <span style={{ color: "var(--color-text-secondary)" }}>|</span>
            <span style={{ color: "var(--color-text-secondary)" }}>
              {exchangeData.filter((e) => e.found).length} of 4 exchanges have data
            </span>
            <span style={{ color: "var(--color-text-secondary)" }}>|</span>
            <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
              Data cutoff: 10 days ago (to ensure VWAP accuracy)
            </span>
          </div>
        </div>
      )}

      {/* Charts */}
      {exchangeData.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(600px, 1fr))", gap: "1rem" }}>
          {exchangeData.map((ex) => renderChart(ex))}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="terminal-box">
          <div className="text-mono terminal-loading" style={{ textAlign: "center", padding: "3rem" }}>
            Loading market data for {inputValue}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && exchangeData.length === 0 && !error && (
        <div className="terminal-box">
          <div className="text-mono" style={{ color: "var(--color-text-muted)", textAlign: "center", padding: "2rem" }}>
            Enter a ticker symbol and click "Load Charts" to view market data
          </div>
        </div>
      )}
    </div>
  );
}

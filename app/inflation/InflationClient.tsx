"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// Preset baskets
const PRESET_BASKETS = {
  consumables: ["DW", "PWO", "COF", "KOM", "PT", "REP", "EXO", "HMS", "MED", "SCN", "ALE", "SC", "FIM", "HSS", "GIN", "VG", "PDA", "MEA"],
};

interface IndexDataPoint {
  date: string;
  timestamp: number;
  indexValue: number;
  contributions: Record<string, number>;
}

interface TickerWeight {
  ticker: string;
  weight: number;
  indexDateVolume: number;
}

interface ApiResponse {
  success: boolean;
  exchange: string;
  indexDate: string;
  indexTimestamp: number;
  weightType: string;
  tickers: string[];
  tickersNotFound: string[];
  weights: TickerWeight[];
  dataPoints: number;
  data: IndexDataPoint[];
  error?: string;
}

export default function InflationClient() {
  // Calculate default index date (276 days in the past)
  const getDefaultIndexDate = () => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 276);
    return date.toISOString().split("T")[0];
  };

  // State
  const [tickers, setTickers] = useState<string>(PRESET_BASKETS.consumables.join(", "));
  const [exchange, setExchange] = useState<string>("ANT");
  const [indexDate, setIndexDate] = useState<string>(getDefaultIndexDate());
  const [weightType, setWeightType] = useState<"equal" | "volume">("equal");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexData, setIndexData] = useState<IndexDataPoint[]>([]);
  const [weights, setWeights] = useState<TickerWeight[]>([]);
  const [apiResponse, setApiResponse] = useState<ApiResponse | null>(null);

  // Load data on mount with default consumables basket
  useEffect(() => {
    handleCalculate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCalculate = async () => {
    setLoading(true);
    setError(null);

    try {
      const tickerList = tickers
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter((t) => t);

      if (tickerList.length === 0) {
        setError("Please enter at least one ticker");
        setLoading(false);
        return;
      }

      const params = new URLSearchParams({
        tickers: tickerList.join(","),
        exchange,
        indexDate,
        weightType,
      });

      const response = await fetch(`/api/inflation?${params}`);
      const data: ApiResponse = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || "Failed to calculate inflation index");
        setLoading(false);
        return;
      }

      setIndexData(data.data);
      setWeights(data.weights);
      setApiResponse(data);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handlePresetBasket = (basket: keyof typeof PRESET_BASKETS) => {
    setTickers(PRESET_BASKETS[basket].join(", "));
  };

  const handleExportCSV = () => {
    if (!apiResponse || indexData.length === 0) return;

    // Build CSV content
    const lines: string[] = [];

    // Metadata section
    lines.push(`# Inflation Index Export`);
    lines.push(`# Exchange: ${apiResponse.exchange}`);
    lines.push(`# Index Date: ${apiResponse.indexDate} (Base = 100)`);
    lines.push(`# Weight Type: ${apiResponse.weightType}`);
    lines.push(`# Tickers: ${apiResponse.tickers.join(", ")}`);
    lines.push(`# Data Points: ${apiResponse.dataPoints}`);
    lines.push(`# Exported: ${new Date().toISOString()}`);
    lines.push(``);

    // Weights section
    lines.push(`# Ticker Weights:`);
    for (const w of weights) {
      if (weightType === "volume") {
        lines.push(`# ${w.ticker}: ${(w.weight * 100).toFixed(4)}% (Volume: ${w.indexDateVolume})`);
      } else {
        lines.push(`# ${w.ticker}: ${(w.weight * 100).toFixed(4)}%`);
      }
    }
    lines.push(``);

    // Header row
    const tickerList = apiResponse.tickers.sort();
    const headers = ["Date", "Timestamp", "Index Value", ...tickerList.map(t => `${t} Contribution`)];
    lines.push(headers.join(","));

    // Data rows
    for (const point of indexData) {
      const row = [
        point.date,
        point.timestamp.toString(),
        point.indexValue.toFixed(6),
        ...tickerList.map(ticker => {
          const contribution = point.contributions[ticker];
          return contribution !== undefined ? contribution.toFixed(6) : "";
        })
      ];
      lines.push(row.join(","));
    }

    // Create blob and download
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const filename = `inflation-index-${apiResponse.exchange}-${apiResponse.indexDate}-${apiResponse.weightType}.csv`;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Prepare chart data
  const chartData = indexData.length > 0 ? [
    {
      x: indexData.map((d) => d.date),
      y: indexData.map((d) => d.indexValue),
      type: "scatter" as const,
      mode: "lines" as const,
      name: "Inflation Index",
      line: {
        color: "#ff9500",
        width: 2,
      },
      hovertemplate: "<b>%{x}</b><br>Index: %{y:.2f}<extra></extra>",
    },
  ] : [];

  const chartLayout = {
    title: {
      text: `${weightType === "equal" ? "Equal-Weighted" : "Volume-Weighted"} Inflation Index (${exchange})`,
      font: { color: "#e6e8eb", family: "var(--font-display)", size: 18 },
    },
    paper_bgcolor: "#0a0e14",
    plot_bgcolor: "#101419",
    font: { color: "#e6e8eb", family: "var(--font-mono)" },
    xaxis: {
      title: "Date",
      gridcolor: "#2a3f5f",
      showgrid: true,
      color: "#a0a8b5",
      rangeselector: {
        buttons: [
          { count: 1, label: "1M", step: "month", stepmode: "backward" },
          { count: 3, label: "3M", step: "month", stepmode: "backward" },
          { count: 6, label: "6M", step: "month", stepmode: "backward" },
          { count: 1, label: "1Y", step: "year", stepmode: "backward" },
          { step: "all", label: "All" },
        ],
        bgcolor: "#1a1f26",
        activecolor: "#ff9500",
        bordercolor: "#2a3f5f",
        font: { color: "#e6e8eb" },
      },
      rangeslider: {
        visible: true,
        bgcolor: "#1a1f26",
        bordercolor: "#2a3f5f",
      },
    },
    yaxis: {
      title: "Index Value (Base 100)",
      gridcolor: "#2a3f5f",
      showgrid: true,
      color: "#a0a8b5",
    },
    hovermode: "x unified" as const,
    margin: { l: 60, r: 40, t: 80, b: 120 },
  };

  const chartConfig = {
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  };

  return (
    <div style={{ padding: "2rem 0" }}>
      <div className="terminal-header">
        <span>📊</span>
        <span>Inflation Index Calculator</span>
      </div>

      {/* Input Controls */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "grid", gap: "1.5rem" }}>
          {/* Preset Baskets */}
          <div>
            <label className="terminal-header" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
              Preset Baskets
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                className="terminal-button"
                onClick={() => handlePresetBasket("consumables")}
                style={{ fontSize: "0.75rem" }}
              >
                Consumables
              </button>
            </div>
          </div>

          {/* Ticker Input */}
          <div>
            <label className="terminal-header" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
              Tickers (comma-separated)
            </label>
            <textarea
              className="terminal-input"
              value={tickers}
              onChange={(e) => setTickers(e.target.value)}
              placeholder="e.g., DW, PWO, COF, RAT"
              rows={3}
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>

          {/* Controls Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
            {/* Exchange */}
            <div>
              <label className="terminal-header" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
                Exchange
              </label>
              <select
                className="terminal-select"
                value={exchange}
                onChange={(e) => setExchange(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="ANT">ANT</option>
                <option value="CIS">CIS</option>
                <option value="ICA">ICA</option>
                <option value="NCC">NCC</option>
              </select>
            </div>

            {/* Index Date */}
            <div>
              <label className="terminal-header" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
                Index Date (Base = 100)
              </label>
              <input
                type="date"
                className="terminal-input"
                value={indexDate}
                onChange={(e) => setIndexDate(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>

            {/* Weight Type */}
            <div>
              <label className="terminal-header" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
                Weighting Method
              </label>
              <div style={{ display: "flex", gap: "1rem", alignItems: "center", paddingTop: "0.5rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="weightType"
                    value="equal"
                    checked={weightType === "equal"}
                    onChange={(e) => setWeightType(e.target.value as "equal" | "volume")}
                  />
                  <span className="text-mono" style={{ fontSize: "0.875rem" }}>Equal</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="weightType"
                    value="volume"
                    checked={weightType === "volume"}
                    onChange={(e) => setWeightType(e.target.value as "equal" | "volume")}
                  />
                  <span className="text-mono" style={{ fontSize: "0.875rem" }}>Volume</span>
                </label>
              </div>
            </div>
          </div>

          {/* Calculate and Export Buttons */}
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <button
              className="terminal-button"
              onClick={handleCalculate}
              disabled={loading}
              style={{ padding: "0.75rem 2rem" }}
            >
              {loading ? "Calculating..." : "Calculate Index"}
            </button>
            <button
              className="terminal-button"
              onClick={handleExportCSV}
              disabled={indexData.length === 0}
              style={{ padding: "0.75rem 2rem" }}
            >
              📥 Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="terminal-box" style={{ marginBottom: "2rem", borderColor: "var(--color-error)" }}>
          <div className="status-error">⚠️ {error}</div>
        </div>
      )}

      {/* Info Display */}
      {apiResponse && !error && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.875rem" }}>
            <div>
              <span className="text-accent">Tickers Found:</span> {apiResponse.tickers.join(", ")}
            </div>
            {apiResponse.tickersNotFound.length > 0 && (
              <div className="status-warning">
                <span className="text-accent">Tickers Not Found:</span> {apiResponse.tickersNotFound.join(", ")}
              </div>
            )}
            <div>
              <span className="text-accent">Data Points:</span> {apiResponse.dataPoints}
            </div>
            <div>
              <span className="text-accent">Index Base Date:</span> {apiResponse.indexDate} (Value = 100)
            </div>
          </div>
        </div>
      )}

      {/* Weights Display */}
      {weights.length > 0 && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div className="terminal-header" style={{ fontSize: "0.75rem" }}>
            Ticker Weights
          </div>
          <div style={{ maxHeight: "200px", overflowY: "auto" }}>
            <table className="terminal-table" style={{ fontSize: "0.75rem" }}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Weight (%)</th>
                  {weightType === "volume" && <th>Index Date Volume</th>}
                </tr>
              </thead>
              <tbody>
                {weights.map((w) => (
                  <tr key={w.ticker}>
                    <td>{w.ticker}</td>
                    <td>{(w.weight * 100).toFixed(2)}%</td>
                    {weightType === "volume" && <td>{w.indexDateVolume.toLocaleString()}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Chart */}
      {indexData.length > 0 && (
        <div className="terminal-box">
          <Plot
            data={chartData}
            layout={chartLayout}
            config={chartConfig}
            style={{ width: "100%", height: "600px" }}
            useResizeHandler={true}
          />
        </div>
      )}

      {indexData.length === 0 && !loading && !error && (
        <div className="terminal-box">
          <div className="text-mono" style={{ color: "var(--color-text-muted)", textAlign: "center", padding: "2rem" }}>
            Click "Calculate Index" to generate the inflation index
          </div>
        </div>
      )}
    </div>
  );
}

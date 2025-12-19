"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// Preset baskets
const PRESET_BASKETS = {
  consumables: ["DW", "PWO", "COF", "KOM", "PT", "REP", "EXO", "HMS", "MED", "SCN", "ALE", "SC", "FIM", "HSS", "GIN", "VG", "PDA", "MEA"],
  frequentlyTraded: ["AL", "ALE", "C", "COF", "CU", "DW", "EPO", "EXO", "FE", "FF", "FIM", "FLP", "FLX", "GIN", "GRN", "HCP", "HMS", "HSE", "HSS", "INS", "KOM", "LBH", "LSE", "LTA", "MAI", "MED", "MFK", "MG", "NL", "NS", "OFF", "PE", "PG", "PSL", "PT", "PWO", "RBH", "RCO", "RDE", "REP", "RSE", "SC", "SCN", "SEA", "SF", "SFK", "SI", "SSC", "STL", "TRN", "TRU", "VG"],
  lAndRFabs: ["LBH", "LDE", "LSE", "LTA", "RBH", "RDE", "RSE", "RTA"],
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

interface MultiExchangeResponse {
  success: boolean;
  exchanges: ApiResponse[];
}

export default function InflationClient() {
  // Calculate default index date (276 days in the past)
  const getDefaultIndexDate = () => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 276);
    return date.toISOString().split("T")[0];
  };

  // State
  const [tickers, setTickers] = useState<string>(PRESET_BASKETS.frequentlyTraded.join(", "));
  const [selectedExchanges, setSelectedExchanges] = useState<string[]>(["ANT"]);
  const [indexDate, setIndexDate] = useState<string>(getDefaultIndexDate());
  const [weightType, setWeightType] = useState<"equal" | "volume">("equal");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchangeResults, setExchangeResults] = useState<ApiResponse[]>([]);

  const handleExchangeToggle = (exchange: string) => {
    setSelectedExchanges(prev => {
      if (prev.includes(exchange)) {
        // Don't allow deselecting all exchanges
        if (prev.length === 1) return prev;
        return prev.filter(e => e !== exchange);
      } else {
        return [...prev, exchange];
      }
    });
  };

  // Load data on mount with default Frequently Traded basket
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

      if (selectedExchanges.length === 0) {
        setError("Please select at least one exchange");
        setLoading(false);
        return;
      }

      // Fetch data for all selected exchanges in parallel
      const fetchPromises = selectedExchanges.map(async (exchange) => {
        const params = new URLSearchParams({
          tickers: tickerList.join(","),
          exchange,
          indexDate,
          weightType,
        });

        const response = await fetch(`/api/inflation?${params}`);
        const data: ApiResponse = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || `Failed to calculate index for ${exchange}`);
        }

        return data;
      });

      const results = await Promise.all(fetchPromises);
      setExchangeResults(results);
    } catch (err: any) {
      setError(err.message || "An error occurred");
      setExchangeResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePresetBasket = (basket: keyof typeof PRESET_BASKETS) => {
    setTickers(PRESET_BASKETS[basket].join(", "));
  };

  const handleExportCSV = () => {
    if (exchangeResults.length === 0) return;

    // Build CSV content
    const lines: string[] = [];

    // Metadata section
    lines.push(`# Inflation Index Export`);
    lines.push(`# Exchanges: ${exchangeResults.map(r => r.exchange).join(", ")}`);
    lines.push(`# Index Date: ${exchangeResults[0].indexDate} (Base = 100)`);
    lines.push(`# Weight Type: ${exchangeResults[0].weightType}`);
    lines.push(`# Tickers: ${exchangeResults[0].tickers.join(", ")}`);
    lines.push(`# Exported: ${new Date().toISOString()}`);
    lines.push(``);

    // Weights section for each exchange
    for (const result of exchangeResults) {
      lines.push(`# ${result.exchange} Ticker Weights:`);
      for (const w of result.weights) {
        if (result.weightType === "volume") {
          lines.push(`# ${w.ticker}: ${(w.weight * 100).toFixed(4)}% (Volume ±7d: ${w.indexDateVolume})`);
        } else {
          lines.push(`# ${w.ticker}: ${(w.weight * 100).toFixed(4)}%`);
        }
      }
      lines.push(``);
    }

    // Header row with all exchange columns
    const headers = ["Date", "Timestamp"];
    for (const result of exchangeResults) {
      headers.push(`${result.exchange} Index Value`);
    }
    lines.push(headers.join(","));

    // Build a combined date list
    const allDates = new Set<number>();
    for (const result of exchangeResults) {
      for (const point of result.data) {
        allDates.add(point.timestamp);
      }
    }
    const sortedDates = Array.from(allDates).sort((a, b) => a - b);

    // Data rows
    for (const timestamp of sortedDates) {
      const date = new Date(timestamp).toISOString().split("T")[0];
      const row = [date, timestamp.toString()];

      for (const result of exchangeResults) {
        const point = result.data.find(d => d.timestamp === timestamp);
        row.push(point ? point.indexValue.toFixed(6) : "");
      }

      lines.push(row.join(","));
    }

    // Create blob and download
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const exchangesList = exchangeResults.map(r => r.exchange).join("-");
    const filename = `inflation-index-${exchangesList}-${exchangeResults[0].indexDate}-${exchangeResults[0].weightType}.csv`;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Calculate cutoff date (10 days before today) for chart display
  const getCutoffDate = () => {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 10);
    cutoff.setUTCHours(0, 0, 0, 0);
    return cutoff.getTime();
  };
  const cutoffTimestamp = getCutoffDate();
  const cutoffDateString = new Date(cutoffTimestamp).toISOString().split("T")[0];

  // Prepare chart data - one line per exchange
  const exchangeColors: Record<string, string> = {
    ANT: "#ff7b3d",  // Reddish orange
    CIS: "#ff1744",  // Bright red
    ICA: "#00cc66",  // Deeper green
    NCC: "#ffdd66",  // Faded yellow
  };

  const chartData = exchangeResults.map((result) => {
    // Filter data to only include points up to 10 days before today
    const filteredData = result.data.filter((d) => d.timestamp <= cutoffTimestamp);

    return {
      x: filteredData.map((d) => d.date),
      y: filteredData.map((d) => d.indexValue),
      type: "scatter" as const,
      mode: "lines" as const,
      name: result.exchange,
      line: {
        color: exchangeColors[result.exchange] || "#ff9500",
        width: 2,
      },
      hovertemplate: `<b>%{x}</b><br>${result.exchange}: %{y:.2f}<extra></extra>`,
    };
  });

  // Calculate y-axis range: 80 to (max + 10) across all exchanges (using filtered data)
  const yAxisRange = exchangeResults.length > 0
    ? [80, Math.max(...exchangeResults.flatMap(r =>
        r.data.filter(d => d.timestamp <= cutoffTimestamp).map(d => d.indexValue)
      )) + 10]
    : undefined;

  const chartLayout = {
    title: {
      text: `${weightType === "equal" ? "Equal-Weighted" : "Volume-Weighted"} Inflation Index`,
      font: { color: "#e6e8eb", family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif", size: 18 },
    },
    paper_bgcolor: "#0a0e14",
    plot_bgcolor: "#101419",
    font: { color: "#e6e8eb", family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif" },
    xaxis: {
      title: "Date",
      gridcolor: "#2a3f5f",
      showgrid: true,
      color: "#a0a8b5",
      range: exchangeResults.length > 0 ? [exchangeResults[0].indexDate, cutoffDateString] : undefined,
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
      range: yAxisRange,
    },
    hovermode: "x unified" as const,
    margin: { l: 60, r: 40, t: 80, b: 120 },
  };

  const chartConfig = {
    displayModeBar: false,
    displaylogo: false,
  };

  return (
    <div>
      {/* Input Controls */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <h1 className="terminal-header" style={{ margin: 0, marginBottom: "1.5rem", fontSize: "1.2rem", paddingBottom: 0, borderBottom: "none", fontWeight: "normal" }}>
          INFLATION INDEX GENERATOR
        </h1>

        <div style={{ display: "grid", gap: "1.5rem" }}>
          {/* Preset Baskets */}
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.875rem", fontFamily: "var(--font-display)", color: "var(--color-text-primary)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>
              Preset Baskets:
            </span>
            <button
              className="terminal-button"
              onClick={() => handlePresetBasket("frequentlyTraded")}
              style={{ fontSize: "0.75rem" }}
            >
              Frequently Traded
            </button>
            <button
              className="terminal-button"
              onClick={() => handlePresetBasket("consumables")}
              style={{ fontSize: "0.75rem" }}
            >
              Consumables
            </button>
            <button
              className="terminal-button"
              onClick={() => handlePresetBasket("lAndRFabs")}
              style={{ fontSize: "0.75rem" }}
            >
              L and R Fabs
            </button>
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
            {/* Exchanges */}
            <div>
              <label className="terminal-header" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
                Exchanges
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", paddingTop: "0.5rem" }}>
                {["ANT", "CIS", "ICA", "NCC"].map((ex) => (
                  <label key={ex} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={selectedExchanges.includes(ex)}
                      onChange={() => handleExchangeToggle(ex)}
                    />
                    <span className="text-mono" style={{ fontSize: "0.875rem" }}>{ex}</span>
                  </label>
                ))}
              </div>
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
                  <span className="text-mono" style={{ fontSize: "0.875rem" }}>Volume (±7 days)</span>
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
              disabled={exchangeResults.length === 0}
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
      {exchangeResults.length > 0 && !error && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.875rem", fontFamily: "var(--font-display)" }}>
            <div>
              <span className="text-accent">Exchanges:</span> {exchangeResults.map(r => r.exchange).join(", ")}
            </div>
            <div>
              <span className="text-accent">Tickers Found:</span> {exchangeResults[0].tickers.join(", ")}
            </div>
            {exchangeResults[0].tickersNotFound.length > 0 && (
              <div className="status-warning">
                <span className="text-accent">Tickers Not Found:</span> {exchangeResults[0].tickersNotFound.join(", ")}
              </div>
            )}
            <div>
              <span className="text-accent">Index Base Date:</span> {exchangeResults[0].indexDate} (Value = 100)
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      {exchangeResults.length > 0 && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <Plot
            data={chartData}
            layout={chartLayout}
            config={chartConfig}
            style={{ width: "100%", height: "600px" }}
            useResizeHandler={true}
          />
        </div>
      )}

      {/* Weights Display */}
      {exchangeResults.length > 0 && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div className="terminal-header" style={{ fontSize: "0.75rem" }}>
            Ticker Weights
          </div>
          <div style={{ maxHeight: "400px", overflowY: "auto" }}>
            {exchangeResults.map((result) => (
              <div key={result.exchange} style={{ marginBottom: "1.5rem" }}>
                <div style={{ fontSize: "0.875rem", color: exchangeColors[result.exchange], marginBottom: "0.5rem", fontWeight: 600 }}>
                  {result.exchange}
                </div>
                <table className="terminal-table" style={{ fontSize: "0.75rem" }}>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Weight (%)</th>
                      {result.weightType === "volume" && <th>Volume (±7d)</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {result.weights.map((w) => (
                      <tr key={w.ticker}>
                        <td>{w.ticker}</td>
                        <td>{(w.weight * 100).toFixed(2)}%</td>
                        {result.weightType === "volume" && <td>{w.indexDateVolume.toLocaleString()}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {exchangeResults.length === 0 && !loading && !error && (
        <div className="terminal-box">
          <div className="text-mono" style={{ color: "var(--color-text-muted)", textAlign: "center", padding: "2rem" }}>
            Click "Calculate Index" to generate the inflation index
          </div>
        </div>
      )}
    </div>
  );
}


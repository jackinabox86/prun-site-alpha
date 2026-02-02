"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Highcharts from "highcharts/highstock";
import HighchartsReact from "highcharts-react-official";

// Initialize Highcharts modules
if (typeof Highcharts === "object") {
  // Set global dark theme
  Highcharts.setOptions({
    chart: {
      backgroundColor: "#0a0e14",
      style: {
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
      },
    },
    title: {
      style: {
        color: "#e6e8eb",
      },
    },
    xAxis: {
      gridLineColor: "#1a2332",
      lineColor: "#2a3f5f",
      tickColor: "#2a3f5f",
      labels: {
        style: {
          color: "#a0a8b5",
        },
      },
    },
    yAxis: {
      gridLineColor: "#1a2332",
      lineColor: "#2a3f5f",
      tickColor: "#2a3f5f",
      labels: {
        style: {
          color: "#a0a8b5",
        },
      },
      title: {
        style: {
          color: "#a0a8b5",
        },
      },
    },
    legend: {
      itemStyle: {
        color: "#a0a8b5",
      },
      itemHoverStyle: {
        color: "#e6e8eb",
      },
    },
    tooltip: {
      backgroundColor: "#1a1f26",
      borderColor: "#2a3f5f",
      style: {
        color: "#e6e8eb",
      },
    },
    navigator: {
      maskFill: "rgba(255, 149, 0, 0.1)",
      outlineColor: "#2a3f5f",
      handles: {
        backgroundColor: "#ff9500",
        borderColor: "#ff7a00",
      },
      xAxis: {
        gridLineColor: "#1a2332",
        labels: {
          style: {
            color: "#6b7280",
          },
        },
      },
      series: {
        color: "#ff9500",
        lineColor: "#ff9500",
      },
    },
    scrollbar: {
      barBackgroundColor: "#2a3f5f",
      barBorderColor: "#2a3f5f",
      buttonBackgroundColor: "#1a1f26",
      buttonBorderColor: "#2a3f5f",
      rifleColor: "#a0a8b5",
      trackBackgroundColor: "#101419",
      trackBorderColor: "#1a2332",
    },
    rangeSelector: {
      buttonTheme: {
        fill: "#1a1f26",
        stroke: "#2a3f5f",
        style: {
          color: "#a0a8b5",
        },
        states: {
          hover: {
            fill: "#2a3f5f",
            stroke: "#ff9500",
            style: {
              color: "#ff9500",
            },
          },
          select: {
            fill: "#ff9500",
            stroke: "#ff7a00",
            style: {
              color: "#0a0e14",
            },
          },
        },
      },
      inputStyle: {
        backgroundColor: "#101419",
        color: "#e6e8eb",
      },
      labelStyle: {
        color: "#a0a8b5",
      },
    },
  });
}

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

// Exchange colors - vibrant but professional
const EXCHANGE_COLORS: Record<string, { primary: string; up: string; down: string }> = {
  ANT: { primary: "#ff9500", up: "#26a69a", down: "#ef5350" },
  CIS: { primary: "#e91e63", up: "#26a69a", down: "#ef5350" },
  ICA: { primary: "#00bcd4", up: "#26a69a", down: "#ef5350" },
  NCC: { primary: "#ffeb3b", up: "#26a69a", down: "#ef5350" },
};

// Calculate date one year ago
const getOneYearAgo = () => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 1);
  return date.getTime();
};

// Calculate cutoff date (10 days before today)
const getCutoffDate = () => {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 10);
  cutoff.setUTCHours(23, 59, 59, 999);
  return cutoff.getTime();
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

  const cutoffTimestamp = getCutoffDate();
  const oneYearAgo = getOneYearAgo();

  // Build Highcharts options for each exchange
  const buildChartOptions = (exchangeInfo: ExchangeChartData): Highcharts.Options | null => {
    if (!exchangeInfo.found || exchangeInfo.data.length === 0) {
      return null;
    }

    const colors = EXCHANGE_COLORS[exchangeInfo.exchange] || EXCHANGE_COLORS.ANT;

    // Filter data to only include points up to 10 days before today
    const filteredData = exchangeInfo.data.filter((d) => d.timestamp <= cutoffTimestamp);

    // Prepare OHLC data (only days with actual trading)
    const ohlcData: [number, number, number, number, number][] = [];
    const volumeData: [number, number][] = [];

    filteredData.forEach((d) => {
      if (d.open !== null && d.close !== null && d.open > 0 && d.close > 0) {
        const high = d.high || Math.max(d.open, d.close);
        const low = d.low || Math.min(d.open, d.close);
        ohlcData.push([d.timestamp, d.open, high, low, d.close]);
        volumeData.push([d.timestamp, d.volume]);
      }
    });

    // Prepare VWAP data - simple line connecting each day's VWAP value
    const vwapData: [number, number][] = [];
    filteredData.forEach((d) => {
      if (d.vwap7d !== null && d.vwap7d > 0) {
        vwapData.push([d.timestamp, d.vwap7d]);
      }
    });

    // Sort all data by timestamp
    ohlcData.sort((a, b) => a[0] - b[0]);
    volumeData.sort((a, b) => a[0] - b[0]);
    vwapData.sort((a, b) => a[0] - b[0]);

    // Build series array
    const series: Highcharts.SeriesOptionsType[] = [
      {
        type: "candlestick",
        name: "OHLC",
        id: "ohlc",
        data: ohlcData,
        color: colors.down,
        upColor: colors.up,
        lineColor: colors.down,
        upLineColor: colors.up,
        tooltip: {
          pointFormat:
            '<span style="color:{point.color}">\u25CF</span> <b>{series.name}</b><br/>' +
            "Open: {point.open:.2f}<br/>" +
            "High: {point.high:.2f}<br/>" +
            "Low: {point.low:.2f}<br/>" +
            "Close: {point.close:.2f}<br/>",
        },
      },
    ];

    // Add VWAP line if enabled
    if (showVwap && vwapData.length > 0) {
      series.push({
        type: "line",
        name: "7d VWAP",
        data: vwapData,
        color: colors.primary,
        lineWidth: 2,
        marker: {
          enabled: false,
        },
        tooltip: {
          pointFormat:
            '<span style="color:{point.color}">\u25CF</span> <b>{series.name}</b>: {point.y:.2f}<br/>',
        },
        yAxis: 0,
      });
    }

    // Add volume if enabled
    if (showVolume && volumeData.length > 0) {
      series.push({
        type: "column",
        name: "Volume",
        data: volumeData,
        yAxis: 1,
        color: "rgba(100, 150, 200, 0.5)",
        tooltip: {
          pointFormat:
            '<span style="color:{point.color}">\u25CF</span> <b>{series.name}</b>: {point.y:,.0f}<br/>',
        },
      });
    }

    const options: Highcharts.Options = {
      chart: {
        height: showVolume ? 500 : 400,
        backgroundColor: "#0a0e14",
        plotBackgroundColor: "#101419",
        plotBorderColor: "#2a3f5f",
        plotBorderWidth: 1,
      },
      title: {
        text: `${exchangeInfo.ticker}.${exchangeInfo.exchange}`,
        style: {
          color: colors.primary,
          fontSize: "16px",
          fontWeight: "600",
        },
      },
      subtitle: {
        text: exchangeInfo.exchangeName,
        style: {
          color: "#a0a8b5",
          fontSize: "12px",
        },
      },
      rangeSelector: {
        buttons: [
          { type: "month", count: 1, text: "1M" },
          { type: "month", count: 3, text: "3M" },
          { type: "month", count: 6, text: "6M" },
          { type: "year", count: 1, text: "1Y" },
          { type: "all", text: "All" },
        ],
        selected: 3, // Default to 1Y
        inputEnabled: true,
      },
      xAxis: {
        type: "datetime",
        min: oneYearAgo,
        crosshair: {
          color: "rgba(255, 149, 0, 0.3)",
          dashStyle: "Dash",
        },
      },
      yAxis: [
        {
          title: {
            text: "Price",
          },
          height: showVolume ? "70%" : "100%",
          lineWidth: 1,
          resize: {
            enabled: true,
          },
          crosshair: {
            color: "rgba(255, 149, 0, 0.3)",
            dashStyle: "Dash",
          },
        },
        ...(showVolume
          ? [
              {
                title: {
                  text: "Volume",
                },
                top: "75%",
                height: "25%",
                offset: 0,
                lineWidth: 1,
              },
            ]
          : []),
      ],
      legend: {
        enabled: true,
        align: "left" as const,
        verticalAlign: "top" as const,
        floating: true,
        x: 60,
        y: 0,
      },
      tooltip: {
        split: false,
        shared: true,
        backgroundColor: "#1a1f26",
        borderColor: "#2a3f5f",
        style: {
          color: "#e6e8eb",
        },
        xDateFormat: "%Y-%m-%d",
      },
      navigator: {
        enabled: true,
        series: {
          color: colors.primary,
          lineColor: colors.primary,
        },
      },
      scrollbar: {
        enabled: true,
      },
      credits: {
        enabled: false,
      },
      series,
    };

    return options;
  };

  // Render chart for an exchange
  const renderChart = (exchangeInfo: ExchangeChartData) => {
    if (!exchangeInfo.found || exchangeInfo.data.length === 0) {
      return (
        <div className="terminal-box" key={exchangeInfo.exchange} style={{ marginBottom: "1.5rem" }}>
          <div
            className="terminal-header"
            style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}
          >
            {exchangeInfo.ticker}.{exchangeInfo.exchange} - {exchangeInfo.exchangeName}
          </div>
          <div
            className="text-mono"
            style={{
              color: "var(--color-text-muted)",
              textAlign: "center",
              padding: "2rem",
            }}
          >
            No market data available for {exchangeInfo.ticker}.{exchangeInfo.exchange}
          </div>
        </div>
      );
    }

    const chartOptions = buildChartOptions(exchangeInfo);
    if (!chartOptions) return null;

    return (
      <div className="terminal-box" key={exchangeInfo.exchange} style={{ marginBottom: "1.5rem", padding: "0.5rem" }}>
        <HighchartsReact
          highcharts={Highcharts}
          constructorType={"stockChart"}
          options={chartOptions}
        />
      </div>
    );
  };

  return (
    <div>
      {/* Search Controls */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <h1
          className="terminal-header"
          style={{
            margin: 0,
            marginBottom: "1.5rem",
            fontSize: "1.2rem",
            paddingBottom: 0,
            borderBottom: "none",
            fontWeight: "normal",
          }}
        >
          MARKET CHARTS
        </h1>

        <div style={{ display: "grid", gap: "1.5rem" }}>
          {/* Quick Select Tickers */}
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "0.875rem",
                fontFamily: "var(--font-display)",
                color: "var(--color-text-primary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                fontWeight: 500,
              }}
            >
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
                  backgroundColor:
                    ticker === t ? "var(--color-accent-primary)" : undefined,
                  color: ticker === t ? "var(--color-bg-primary)" : undefined,
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Ticker Search */}
          <div
            style={{
              display: "flex",
              gap: "1rem",
              alignItems: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: "150px" }}>
              <label
                className="terminal-header"
                style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}
              >
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
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showVwap}
                onChange={(e) => setShowVwap(e.target.checked)}
              />
              <span className="text-mono" style={{ fontSize: "0.875rem" }}>
                Show 7-Day VWAP
              </span>
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showVolume}
                onChange={(e) => setShowVolume(e.target.checked)}
              />
              <span className="text-mono" style={{ fontSize: "0.875rem" }}>
                Show Volume
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div
          className="terminal-box"
          style={{ marginBottom: "2rem", borderColor: "var(--color-error)" }}
        >
          <div className="status-error">Warning: {error}</div>
        </div>
      )}

      {/* Info Banner */}
      {ticker && exchangeData.length > 0 && !error && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div
            style={{
              display: "flex",
              gap: "1rem",
              alignItems: "center",
              flexWrap: "wrap",
              fontSize: "0.875rem",
            }}
          >
            <span
              className="text-accent"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Showing: {ticker}
            </span>
            <span style={{ color: "var(--color-text-secondary)" }}>|</span>
            <span style={{ color: "var(--color-text-secondary)" }}>
              {exchangeData.filter((e) => e.found).length} of 4 exchanges have
              data
            </span>
            <span style={{ color: "var(--color-text-secondary)" }}>|</span>
            <span
              style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}
            >
              Default view: Past year (use range selector to adjust)
            </span>
          </div>
        </div>
      )}

      {/* Charts */}
      {exchangeData.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(600px, 1fr))",
            gap: "1rem",
          }}
        >
          {exchangeData.map((ex) => renderChart(ex))}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="terminal-box">
          <div
            className="text-mono terminal-loading"
            style={{ textAlign: "center", padding: "3rem" }}
          >
            Loading market data for {inputValue}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && exchangeData.length === 0 && !error && (
        <div className="terminal-box">
          <div
            className="text-mono"
            style={{
              color: "var(--color-text-muted)",
              textAlign: "center",
              padding: "2rem",
            }}
          >
            Enter a ticker symbol and click "Load Charts" to view market data
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";

interface ExchangeStats {
  exchange: string;
  avgTradedCount: number;
  recordCount: number;
  avgPrice: number;
  totalVolume: number;
  totalTraded: number;
}

interface AnalysisResult {
  days: number;
  cutoffDate: string;
  exchangeStats: ExchangeStats[];
  universeTotal: {
    avgTradedCount: number;
    recordCount: number;
    avgPrice: number;
    totalVolume: number;
    totalTraded: number;
  };
  tickerCount: number;
  filesProcessed: number;
  lastUpdated: number;
  error?: string;
  hint?: string;
}

export default function HistoricalAnalysisClient() {
  const [days, setDays] = useState<string>("90");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const daysNum = parseInt(days, 10);
      if (isNaN(daysNum) || daysNum <= 0) {
        setError("Please enter a valid number of days");
        return;
      }

      const qs = new URLSearchParams({ days: days });
      const res = await fetch(`/api/historical-analysis?${qs.toString()}`, {
        cache: "no-store",
      });

      const json: AnalysisResult = await res.json();

      if (json.error) {
        setError(json.error);
        if (json.hint) {
          setError(`${json.error}\n\nHint: ${json.hint}`);
        }
        setData(null);
        return;
      }

      setData(json);
    } catch (err: any) {
      setError(err.message || "Failed to load analysis data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  // Auto-load on mount and when days changes
  useEffect(() => {
    loadData();
  }, [loadData]);

  const formatNumber = (value: number): string => {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatInteger = (value: number): string => {
    return Math.floor(value).toLocaleString();
  };

  return (
    <div style={{ padding: "20px", maxWidth: "1400px", margin: "0 auto" }}>
      <h1 style={{ color: "#ff8c00", marginBottom: "10px" }}>
        Historical Trading Data Analysis
      </h1>
      <p style={{ color: "#888", marginBottom: "20px", fontSize: "14px" }}>
        Analyze trading activity across all exchanges and materials
      </p>

      {/* Input Section */}
      <div style={{ marginBottom: "30px" }}>
        <div style={{ display: "flex", gap: "15px", alignItems: "center", marginBottom: "15px" }}>
          <div>
            <label
              htmlFor="days-input"
              style={{ display: "block", color: "#ccc", marginBottom: "5px", fontSize: "14px" }}
            >
              Number of Days:
            </label>
            <input
              id="days-input"
              type="number"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              min="1"
              max="365"
              style={{
                padding: "8px 12px",
                fontSize: "14px",
                backgroundColor: "#1a1a1a",
                color: "#ccc",
                border: "1px solid #444",
                borderRadius: "4px",
                width: "120px",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              onClick={loadData}
              disabled={loading}
              style={{
                padding: "8px 20px",
                fontSize: "14px",
                backgroundColor: "#ff8c00",
                color: "#000",
                border: "none",
                borderRadius: "4px",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                fontWeight: "bold",
              }}
            >
              {loading ? "Loading..." : "Analyze"}
            </button>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: "15px",
            marginBottom: "20px",
            backgroundColor: "#2a1a1a",
            border: "1px solid #ff4444",
            borderRadius: "4px",
            color: "#ff4444",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      {/* Results Display */}
      {data && (
        <>
          {/* Summary Info */}
          <div
            style={{
              padding: "15px",
              marginBottom: "30px",
              backgroundColor: "#1a1a1a",
              border: "1px solid #444",
              borderRadius: "4px",
            }}
          >
            <h2 style={{ color: "#ff8c00", marginBottom: "15px", fontSize: "18px" }}>
              Analysis Summary
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "15px" }}>
              <div>
                <div style={{ color: "#888", fontSize: "12px" }}>Period</div>
                <div style={{ color: "#ccc", fontSize: "16px", fontWeight: "bold" }}>
                  Last {data.days} days
                </div>
                <div style={{ color: "#666", fontSize: "11px" }}>
                  Since {new Date(data.cutoffDate).toLocaleDateString()}
                </div>
              </div>
              <div>
                <div style={{ color: "#888", fontSize: "12px" }}>Tickers Processed</div>
                <div style={{ color: "#ccc", fontSize: "16px", fontWeight: "bold" }}>
                  {data.tickerCount}
                </div>
              </div>
              <div>
                <div style={{ color: "#888", fontSize: "12px" }}>Files Processed</div>
                <div style={{ color: "#ccc", fontSize: "16px", fontWeight: "bold" }}>
                  {data.filesProcessed}
                </div>
              </div>
              <div>
                <div style={{ color: "#888", fontSize: "12px" }}>Last Updated</div>
                <div style={{ color: "#ccc", fontSize: "16px", fontWeight: "bold" }}>
                  {new Date(data.lastUpdated).toLocaleTimeString()}
                </div>
              </div>
            </div>
          </div>

          {/* Exchange Stats Table */}
          <div style={{ marginBottom: "30px" }}>
            <h2 style={{ color: "#ff8c00", marginBottom: "15px", fontSize: "18px" }}>
              Exchange Statistics
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  backgroundColor: "#1a1a1a",
                  color: "#ccc",
                  borderCollapse: "collapse",
                  fontSize: "14px",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "2px solid #ff8c00" }}>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "left",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Exchange
                    </th>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Avg Traded Count
                    </th>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Record Count
                    </th>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Avg Price
                    </th>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Total Volume
                    </th>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Total Traded
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.exchangeStats.map((exchange, idx) => (
                    <tr
                      key={exchange.exchange}
                      style={{
                        borderBottom: "1px solid #333",
                        backgroundColor: idx % 2 === 0 ? "#1a1a1a" : "#222",
                      }}
                    >
                      <td
                        style={{
                          padding: "12px",
                          fontWeight: "bold",
                          color: "#ff8c00",
                        }}
                      >
                        {exchange.exchange}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        {formatNumber(exchange.avgTradedCount)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        {formatInteger(exchange.recordCount)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        {formatNumber(exchange.avgPrice)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        {formatInteger(exchange.totalVolume)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        {formatInteger(exchange.totalTraded)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Universe Total */}
          <div style={{ marginBottom: "30px" }}>
            <h2 style={{ color: "#ff8c00", marginBottom: "15px", fontSize: "18px" }}>
              Universe Total
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  backgroundColor: "#1a1a1a",
                  color: "#ccc",
                  borderCollapse: "collapse",
                  fontSize: "14px",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "2px solid #ff8c00" }}>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "left",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Metric
                    </th>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid #333", backgroundColor: "#1a1a1a" }}>
                    <td style={{ padding: "12px", fontWeight: "bold" }}>
                      Average Traded Count
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {formatNumber(data.universeTotal.avgTradedCount)}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #333", backgroundColor: "#222" }}>
                    <td style={{ padding: "12px", fontWeight: "bold" }}>
                      Total Records
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {formatInteger(data.universeTotal.recordCount)}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #333", backgroundColor: "#1a1a1a" }}>
                    <td style={{ padding: "12px", fontWeight: "bold" }}>
                      Average Price
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {formatNumber(data.universeTotal.avgPrice)}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #333", backgroundColor: "#222" }}>
                    <td style={{ padding: "12px", fontWeight: "bold" }}>
                      Total Volume
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {formatInteger(data.universeTotal.totalVolume)}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #333", backgroundColor: "#1a1a1a" }}>
                    <td style={{ padding: "12px", fontWeight: "bold" }}>
                      Total Traded
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {formatInteger(data.universeTotal.totalTraded)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Info Note */}
          <div
            style={{
              padding: "15px",
              backgroundColor: "#1a2a1a",
              border: "1px solid #4a7c4a",
              borderRadius: "4px",
              color: "#8ac98a",
              fontSize: "13px",
            }}
          >
            <strong>Note:</strong> Average Traded Count is the average number of units traded per
            record. Average Price is calculated as Total Volume divided by Total Traded. Record
            Count represents the number of daily data points available for each exchange over the
            selected period.
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";

interface BidComparison {
  materialTicker: string;
  exchangeCode: string;
  myLimit: number;
  marketBid: number;
  difference: number;
  percentBelow: number;
  status: string;
  amount: number;
  initialAmount: number;
  orderType: string;
}

interface ApiResponse {
  comparisons: BidComparison[];
  totalOrders: number;
  activeBuyOrders: number;
  outbidCount: number;
  _sampleOrder: Record<string, unknown> | null;
  _sampleExchange: Record<string, unknown> | null;
  error?: string;
}

type SortField =
  | "materialTicker"
  | "exchangeCode"
  | "myLimit"
  | "marketBid"
  | "difference"
  | "percentBelow";

const EXCHANGE_LABELS: Record<string, string> = {
  AI1: "ANT",
  CI1: "BEN",
  IC1: "HRT",
  NC1: "MOR",
};

function formatExchange(code: string): string {
  return EXCHANGE_LABELS[code] || code;
}

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function BidUpdateClient() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("percentBelow");
  const [sortAsc, setSortAsc] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bid-update");
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setData(json);
        setLastRefresh(new Date());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(field === "materialTicker" || field === "exchangeCode");
    }
  };

  const sortedComparisons = data?.comparisons
    ? [...data.comparisons].sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        if (typeof aVal === "string" && typeof bVal === "string") {
          return sortAsc
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }
        const diff = (aVal as number) - (bVal as number);
        return sortAsc ? diff : -diff;
      })
    : [];

  const SortHeader = ({
    field,
    label,
    align,
  }: {
    field: SortField;
    label: string;
    align?: string;
  }) => (
    <th
      onClick={() => handleSort(field)}
      style={{
        cursor: "pointer",
        textAlign: (align as "left" | "right") || "left",
        padding: "0.5rem 0.75rem",
        borderBottom: "1px solid var(--color-border-primary)",
        fontSize: "0.75rem",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color:
          sortField === field
            ? "var(--color-accent-primary)"
            : "var(--color-text-secondary)",
        whiteSpace: "nowrap",
        userSelect: "none",
      }}
    >
      {label} {sortField === field ? (sortAsc ? "▲" : "▼") : ""}
    </th>
  );

  return (
    <>
      {/* Header */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <h1
          className="terminal-header"
          style={{ margin: 0, fontSize: "1.2rem" }}
        >
          BID UPDATE // CXOS_OUTBID_SCANNER
        </h1>
        <p
          style={{
            marginTop: "1rem",
            marginBottom: 0,
            color: "var(--color-text-secondary)",
            fontSize: "0.875rem",
            lineHeight: "1.6",
          }}
        >
          Compares your active buy orders (CXOS) against current market bids.
          Shows orders where the market bid exceeds your limit price, indicating
          you may be outbid.
          <span
            className="text-mono"
            style={{
              display: "block",
              marginTop: "0.5rem",
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
            }}
          >
            Source: rest.fnar.net/cxos/jackinabox + rest.fnar.net/exchange/all
          </span>
        </p>
      </div>

      {/* Controls */}
      <div style={{ marginBottom: "2rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={fetchData}
          disabled={loading}
          className="terminal-button"
          style={{ padding: "0.5rem 1.5rem" }}
        >
          {loading ? "Scanning..." : "Refresh"}
        </button>
        {lastRefresh && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
            }}
          >
            Last scan: {lastRefresh.toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="terminal-button"
          style={{
            padding: "0.25rem 0.75rem",
            fontSize: "0.7rem",
            marginLeft: "auto",
            opacity: 0.5,
          }}
        >
          {showDebug ? "Hide Debug" : "Debug"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="terminal-box"
          style={{
            marginBottom: "2rem",
            borderColor: "var(--color-error, #ff4444)",
          }}
        >
          <div
            style={{
              color: "var(--color-error, #ff4444)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.875rem",
            }}
          >
            [ERROR] {error}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div
          className="terminal-box"
          style={{ textAlign: "center", padding: "3rem 1rem" }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.875rem",
              color: "var(--color-text-muted)",
            }}
          >
            <span
              className="text-accent"
              style={{ display: "block", marginBottom: "1rem", fontSize: "1.2rem" }}
            >
              [SCANNING]
            </span>
            Fetching CXOS orders and exchange data...
          </div>
        </div>
      )}

      {/* Summary Stats */}
      {data && !error && (
        <div
          className="terminal-box"
          style={{
            marginBottom: "2rem",
            display: "flex",
            gap: "2rem",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.7rem",
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                marginBottom: "0.25rem",
              }}
            >
              Total Orders
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "1.25rem",
                color: "var(--color-text-primary)",
              }}
            >
              {data.totalOrders}
            </div>
          </div>
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.7rem",
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                marginBottom: "0.25rem",
              }}
            >
              Active Buy Orders
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "1.25rem",
                color: "var(--color-text-primary)",
              }}
            >
              {data.activeBuyOrders}
            </div>
          </div>
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.7rem",
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                marginBottom: "0.25rem",
              }}
            >
              Outbid
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "1.25rem",
                color:
                  data.outbidCount > 0
                    ? "var(--color-accent-primary)"
                    : "var(--color-success, #44ff44)",
              }}
            >
              {data.outbidCount}
            </div>
          </div>
        </div>
      )}

      {/* Results Table */}
      {data && !error && sortedComparisons.length > 0 && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div
            className="terminal-header"
            style={{ marginBottom: "1rem" }}
          >
            Outbid Orders ({sortedComparisons.length})
          </div>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontFamily: "var(--font-mono)",
                fontSize: "0.875rem",
              }}
            >
              <thead>
                <tr>
                  <SortHeader field="materialTicker" label="Ticker" />
                  <SortHeader field="exchangeCode" label="Exchange" />
                  <SortHeader field="myLimit" label="My Limit" align="right" />
                  <SortHeader
                    field="marketBid"
                    label="Market Bid"
                    align="right"
                  />
                  <SortHeader
                    field="difference"
                    label="Diff"
                    align="right"
                  />
                  <SortHeader
                    field="percentBelow"
                    label="% Below"
                    align="right"
                  />
                  <th
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderBottom: "1px solid var(--color-border-primary)",
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--color-text-secondary)",
                      textAlign: "left",
                    }}
                  >
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedComparisons.map((row, i) => (
                  <tr
                    key={`${row.materialTicker}-${row.exchangeCode}-${i}`}
                    style={{
                      borderBottom: "1px solid var(--color-border-secondary, rgba(255,255,255,0.05))",
                    }}
                  >
                    <td
                      style={{
                        padding: "0.5rem 0.75rem",
                        color: "var(--color-accent-primary)",
                        fontWeight: "bold",
                      }}
                    >
                      {row.materialTicker}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      {formatExchange(row.exchangeCode)}
                    </td>
                    <td
                      style={{
                        padding: "0.5rem 0.75rem",
                        textAlign: "right",
                      }}
                    >
                      {formatCurrency(row.myLimit)}
                    </td>
                    <td
                      style={{
                        padding: "0.5rem 0.75rem",
                        textAlign: "right",
                        color: "var(--color-accent-primary)",
                      }}
                    >
                      {formatCurrency(row.marketBid)}
                    </td>
                    <td
                      style={{
                        padding: "0.5rem 0.75rem",
                        textAlign: "right",
                        color: "var(--color-accent-primary)",
                      }}
                    >
                      +{formatCurrency(row.difference)}
                    </td>
                    <td
                      style={{
                        padding: "0.5rem 0.75rem",
                        textAlign: "right",
                        color:
                          row.percentBelow > 20
                            ? "var(--color-error, #ff4444)"
                            : row.percentBelow > 10
                              ? "var(--color-accent-primary)"
                              : "var(--color-text-secondary)",
                      }}
                    >
                      {row.percentBelow.toFixed(1)}%
                    </td>
                    <td
                      style={{
                        padding: "0.5rem 0.75rem",
                        fontSize: "0.75rem",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      {row.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* No outbids */}
      {data && !error && sortedComparisons.length === 0 && (
        <div
          className="terminal-box"
          style={{ textAlign: "center", padding: "3rem 1rem" }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.875rem",
              color: "var(--color-text-muted)",
            }}
          >
            <span
              style={{
                display: "block",
                marginBottom: "1rem",
                fontSize: "1.2rem",
                color: "var(--color-success, #44ff44)",
              }}
            >
              [ALL CLEAR]
            </span>
            {data.activeBuyOrders > 0
              ? `All ${data.activeBuyOrders} active buy orders are at or above the current market bid.`
              : "No active buy orders found."}
          </div>
        </div>
      )}

      {/* Debug Panel */}
      {showDebug && data && (
        <div
          className="terminal-box"
          style={{ marginBottom: "2rem", opacity: 0.7 }}
        >
          <div
            className="terminal-header"
            style={{ marginBottom: "1rem", fontSize: "0.8rem" }}
          >
            Debug: Sample API Responses
          </div>
          {data._sampleOrder && (
            <div style={{ marginBottom: "1rem" }}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.7rem",
                  color: "var(--color-accent-primary)",
                  marginBottom: "0.5rem",
                }}
              >
                Sample CXOS Order (first record):
              </div>
              <pre
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.7rem",
                  color: "var(--color-text-secondary)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  margin: 0,
                }}
              >
                {JSON.stringify(data._sampleOrder, null, 2)}
              </pre>
            </div>
          )}
          {data._sampleExchange && (
            <div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.7rem",
                  color: "var(--color-accent-primary)",
                  marginBottom: "0.5rem",
                }}
              >
                Sample Exchange Entry (first record):
              </div>
              <pre
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.7rem",
                  color: "var(--color-text-secondary)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  margin: 0,
                }}
              >
                {JSON.stringify(data._sampleExchange, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </>
  );
}

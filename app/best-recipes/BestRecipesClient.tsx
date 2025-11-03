"use client";

import { useState, useEffect } from "react";
import { scenarioDisplayName } from "@/core/scenario";
import { tickerFilterGroups } from "@/lib/tickerFilters";
import type { Exchange } from "@/types";

interface BestRecipeResult {
  ticker: string;
  recipeId: string | null;
  scenario: string;
  profitPA: number;
  buyAllProfitPA: number | null;
}

interface ApiResponse {
  success: boolean;
  data?: BestRecipeResult[];
  count?: number;
  exchange?: Exchange;
  error?: string;
}

// Display names for exchange selection (UNV split into UNV7/UNV30)
const EXCHANGE_DISPLAYS = [
  { display: "ANT", value: "ANT" as Exchange },
  { display: "CIS", value: "CIS" as Exchange },
  { display: "ICA", value: "ICA" as Exchange },
  { display: "NCC", value: "NCC" as Exchange },
  { display: "UNV7", value: "UNV7" as any },
  { display: "UNV30", value: "UNV30" as any },
];

const EXCHANGES: Exchange[] = ["ANT", "CIS", "ICA", "NCC", "UNV"];

export default function BestRecipesClient() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BestRecipeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<keyof BestRecipeResult>("ticker");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [filterText, setFilterText] = useState("");
  const [selectedFilterGroupId, setSelectedFilterGroupId] = useState<string>("all");
  const [exchange, setExchange] = useState<string>("ANT");

  // Read exchange from URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const exchangeParam = params.get("exchange")?.toUpperCase();
    if (exchangeParam) {
      // Check if it's a valid display value
      const validDisplay = EXCHANGE_DISPLAYS.find(ex => ex.display === exchangeParam);
      if (validDisplay) {
        setExchange(validDisplay.display);
      }
    }
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Update URL with current exchange
      const url = new URL(window.location.href);
      url.searchParams.set("exchange", exchange);
      window.history.replaceState({}, "", url);

      // Add a longer timeout for this computation-heavy request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 min timeout

      const qs = new URLSearchParams({ exchange });
      const res = await fetch(`/api/best-recipes?${qs.toString()}`, {
        cache: "no-store",
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text();
        let json: ApiResponse;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(`Server error (${res.status}): ${text.substring(0, 200)}`);
        }
        throw new Error(json.error || `${res.status} ${res.statusText}`);
      }

      const json: ApiResponse = await res.json();
      if (!json.success) {
        throw new Error(json.error || "Unknown error");
      }
      setData(json.data || []);
    } catch (e: any) {
      if (e.name === "AbortError") {
        setError("Request timed out after 5 minutes. The calculation may be too complex.");
      } else {
        setError(String(e?.message ?? e));
      }
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (column: keyof BestRecipeResult) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // Filter and sort data
  // First, apply ticker group filter
  const selectedGroup = tickerFilterGroups.find(g => g.id === selectedFilterGroupId);
  const groupFilteredData = selectedGroup?.tickers
    ? data.filter((row) => selectedGroup.tickers!.includes(row.ticker))
    : data; // If tickers is null (All), show all data

  // Then, apply text search within the group-filtered results (ticker name only)
  // Support exact match when wrapped in quotes: "C" matches only C, not CRU
  const trimmedFilter = filterText.trim();
  const isExactMatch = trimmedFilter.startsWith('"') && trimmedFilter.endsWith('"') && trimmedFilter.length > 1;
  const searchTerm = isExactMatch
    ? trimmedFilter.slice(1, -1) // Remove quotes
    : trimmedFilter;

  const filteredData = groupFilteredData.filter((row) =>
    isExactMatch
      ? row.ticker.toLowerCase() === searchTerm.toLowerCase()
      : row.ticker.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sortedData = [...filteredData].sort((a, b) => {
    const aVal = a[sortColumn];
    const bVal = b[sortColumn];

    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    }

    const aStr = String(aVal ?? "");
    const bStr = String(bVal ?? "");
    return sortDirection === "asc"
      ? aStr.localeCompare(bStr)
      : bStr.localeCompare(aStr);
  });

  return (
    <main style={{
      padding: "24px",
      maxWidth: "100%",
      fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ marginBottom: 16 }}>Best Recipe IDs - {exchange}</h1>

        {/* Exchange Navigation Links */}
        <div style={{
          display: "flex",
          gap: 12,
          marginBottom: 16,
          padding: 16,
          backgroundColor: "#f8f9fa",
          borderRadius: 6,
          border: "1px solid #dee2e6"
        }}>
          <span style={{ fontWeight: 600, marginRight: 8 }}>Exchange:</span>
          {EXCHANGE_DISPLAYS.map((exConfig) => (
            <a
              key={exConfig.display}
              href={`?exchange=${exConfig.display}`}
              onClick={(e) => {
                e.preventDefault();
                setExchange(exConfig.display);
              }}
              style={{
                padding: "8px 16px",
                fontWeight: exchange === exConfig.display ? 600 : 400,
                backgroundColor: exchange === exConfig.display ? "#007bff" : "white",
                color: exchange === exConfig.display ? "white" : "#007bff",
                border: `1px solid ${exchange === exConfig.display ? "#007bff" : "#ccc"}`,
                borderRadius: 4,
                textDecoration: "none",
                cursor: "pointer",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => {
                if (exchange !== exConfig.display) {
                  e.currentTarget.style.backgroundColor = "#e7f3ff";
                }
              }}
              onMouseLeave={(e) => {
                if (exchange !== exConfig.display) {
                  e.currentTarget.style.backgroundColor = "white";
                }
              }}
            >
              {exConfig.display}
            </a>
          ))}
        </div>

        <p style={{ margin: "8px 0 16px", color: "#555", maxWidth: 900 }}>
          This page displays the best production recipe for each ticker on the {exchange} exchange, calculated in dependency order.
          Each ticker shows its optimal recipe ID, scenario, profit per area (P/A), and the P/A if all inputs are bought (Buy All P/A).
          This data is generated dynamically from the current recipes and prices data.
        </p>

        {loading && (
          <div style={{
            padding: 16,
            backgroundColor: "#fff3cd",
            border: "1px solid #ffc107",
            borderRadius: 4,
            color: "#856404",
            marginBottom: 16
          }}>
            <strong>Processing...</strong> Calculating best recipes for all tickers.
            This may take 1-3 minutes depending on the number of tickers.
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
          <button
            onClick={loadData}
            disabled={loading}
            style={{
              padding: "10px 20px",
              fontWeight: 600,
              fontFamily: "inherit",
              backgroundColor: loading ? "#ccc" : "#007bff",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: loading ? "not-allowed" : "pointer"
            }}
          >
            {loading ? "Generating..." : "Generate Best Recipes"}
          </button>

          {data.length > 0 && (
            <input
              type="text"
              placeholder='Filter by ticker name (use "quotes" for exact match)'
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={{
                padding: "8px 12px",
                fontFamily: "inherit",
                border: "1px solid #ccc",
                borderRadius: 4,
                flex: 1,
                maxWidth: 400
              }}
            />
          )}
        </div>

        {/* Ticker Group Filters */}
        {data.length > 0 && (
          <div style={{
            display: "flex",
            gap: 8,
            marginBottom: 16,
            flexWrap: "wrap",
            alignItems: "center"
          }}>
            <span style={{ fontWeight: 600, marginRight: 4 }}>Filter by:</span>
            {tickerFilterGroups.map((group) => (
              <button
                key={group.id}
                onClick={() => setSelectedFilterGroupId(group.id)}
                style={{
                  padding: "6px 16px",
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: selectedFilterGroupId === group.id ? 600 : 400,
                  backgroundColor: selectedFilterGroupId === group.id ? "#007bff" : "#f8f9fa",
                  color: selectedFilterGroupId === group.id ? "white" : "#333",
                  border: selectedFilterGroupId === group.id ? "1px solid #007bff" : "1px solid #ccc",
                  borderRadius: 4,
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => {
                  if (selectedFilterGroupId !== group.id) {
                    e.currentTarget.style.backgroundColor = "#e9ecef";
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedFilterGroupId !== group.id) {
                    e.currentTarget.style.backgroundColor = "#f8f9fa";
                  }
                }}
              >
                {group.label}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div style={{
            padding: 16,
            backgroundColor: "#fee",
            border: "1px solid #fcc",
            borderRadius: 4,
            color: "#c00",
            marginBottom: 16
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {data.length > 0 && (
          <div style={{
            marginTop: 16,
            backgroundColor: "#f8f9fa",
            border: "1px solid #dee2e6",
            borderRadius: 6,
            padding: 16
          }}>
            <p style={{ margin: 0, fontSize: 14 }}>
              <strong>Showing:</strong> {sortedData.length} ticker{sortedData.length !== 1 ? 's' : ''}
              {selectedFilterGroupId !== 'all' && ` (from ${groupFilteredData.length} in ${selectedGroup?.label})`}
              {data.length > sortedData.length && ` out of ${data.length} total`}
            </p>
          </div>
        )}

        {data.length > 0 && (
          <div style={{ marginTop: 16, overflowX: "auto" }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              backgroundColor: "white",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
            }}>
              <thead>
                <tr style={{ backgroundColor: "#f8f9fa", borderBottom: "2px solid #dee2e6" }}>
                  {["ticker", "recipeId", "scenario", "profitPA", "buyAllProfitPA"].map((col) => (
                    <th
                      key={col}
                      onClick={() => handleSort(col as keyof BestRecipeResult)}
                      style={{
                        padding: "12px 16px",
                        textAlign: "left",
                        fontWeight: 600,
                        cursor: "pointer",
                        userSelect: "none",
                        position: "relative",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {col === "ticker" && "Ticker"}
                      {col === "recipeId" && "RecipeID"}
                      {col === "scenario" && "Scenario"}
                      {col === "profitPA" && "Profit P/A"}
                      {col === "buyAllProfitPA" && "Buy All P/A"}
                      {sortColumn === col && (
                        <span style={{ marginLeft: 6 }}>
                          {sortDirection === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                    </th>
                  ))}
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "left",
                      fontWeight: 600,
                      whiteSpace: "nowrap"
                    }}
                  >
                    Analysis
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map((row, idx) => (
                  <tr
                    key={`${row.ticker}-${idx}`}
                    style={{
                      borderBottom: "1px solid #dee2e6",
                      backgroundColor: idx % 2 === 0 ? "white" : "#f8f9fa"
                    }}
                  >
                    <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                      {row.ticker}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {row.recipeId || "—"}
                    </td>
                    <td
                      style={{ padding: "12px 16px", fontSize: 14, maxWidth: 400, wordWrap: "break-word", cursor: "help" }}
                      title={row.scenario || ""}
                    >
                      {row.scenario ? scenarioDisplayName(row.scenario) : "—"}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      {typeof row.profitPA === "number" && Number.isFinite(row.profitPA)
                        ? `₳${row.profitPA.toFixed(1).replace(/\.0$/, "")}`
                        : "—"}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      {row.buyAllProfitPA === null
                        ? "Input N/A"
                        : typeof row.buyAllProfitPA === "number" && Number.isFinite(row.buyAllProfitPA)
                        ? `₳${row.buyAllProfitPA.toFixed(1).replace(/\.0$/, "")}`
                        : "—"}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <a
                        href={`/?ticker=${encodeURIComponent(row.ticker)}`}
                        style={{
                          color: "#007bff",
                          textDecoration: "none",
                          fontWeight: 600
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.textDecoration = "underline"}
                        onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
                      >
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && data.length === 0 && !error && (
          <div style={{
            marginTop: 32,
            padding: 32,
            textAlign: "center",
            color: "#666",
            backgroundColor: "#f8f9fa",
            borderRadius: 6
          }}>
            Click "Generate Best Recipes" to calculate optimal recipes for all tickers.
          </div>
        )}
      </div>
    </main>
  );
}

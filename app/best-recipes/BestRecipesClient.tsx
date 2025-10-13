"use client";

import { useEffect, useState } from "react";

interface BestRecipeResult {
  ticker: string;
  recipeId: string | null;
  scenario: string;
  profitPA: number;
  buyAllProfitPA: number;
}

interface ApiResponse {
  success: boolean;
  data?: BestRecipeResult[];
  count?: number;
  error?: string;
}

export default function BestRecipesClient() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BestRecipeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<keyof BestRecipeResult>("ticker");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [filterText, setFilterText] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Add a longer timeout for this computation-heavy request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 min timeout

      const res = await fetch("/api/best-recipes", {
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
  const filteredData = data.filter((row) =>
    Object.values(row).some((val) =>
      String(val).toLowerCase().includes(filterText.toLowerCase())
    )
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
        <h1 style={{ marginBottom: 16 }}>Best Recipe IDs</h1>

        <p style={{ margin: "8px 0 16px", color: "#555", maxWidth: 900 }}>
          This page displays the best production recipe for each ticker, calculated in dependency order.
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
              placeholder="Filter results..."
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
              <strong>Total Results:</strong> {sortedData.length} / {data.length} tickers
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
                        position: "relative"
                      }}
                    >
                      {col === "ticker" && "Ticker"}
                      {col === "recipeId" && "Recipe ID"}
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
                    <td style={{ padding: "12px 16px", fontFamily: "monospace" }}>
                      {row.recipeId || "—"}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 14, maxWidth: 400, wordWrap: "break-word" }}>
                      {row.scenario || "—"}
                    </td>
                    <td style={{ padding: "12px 16px", fontFamily: "monospace" }}>
                      {typeof row.profitPA === "number" && Number.isFinite(row.profitPA)
                        ? row.profitPA.toFixed(6)
                        : "—"}
                    </td>
                    <td style={{ padding: "12px 16px", fontFamily: "monospace" }}>
                      {typeof row.buyAllProfitPA === "number" && Number.isFinite(row.buyAllProfitPA)
                        ? row.buyAllProfitPA.toFixed(6)
                        : "—"}
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

"use client";

import { useState, useEffect, useMemo } from "react";
import { scenarioDisplayName } from "@/core/scenario";
import { tickerFilterGroups } from "@/lib/tickerFilters";
import type { Exchange } from "@/types";
import { formatProfitPerArea } from "@/lib/formatting";

interface BestRecipeResult {
  ticker: string;
  recipeId: string | null;
  scenario: string;
  profitPA: number;
  buyAllProfitPA: number | null;
  building?: string | null;
}

interface ApiResponse {
  success: boolean;
  data?: BestRecipeResult[];
  count?: number;
  exchange?: Exchange;
  error?: string;
}

// Display names for exchange selection
const EXCHANGE_DISPLAYS = [
  { display: "ANT", value: "ANT" as Exchange },
  { display: "CIS", value: "CIS" as Exchange },
  { display: "ICA", value: "ICA" as Exchange },
  { display: "NCC", value: "NCC" as Exchange },
];

const EXCHANGES: Exchange[] = ["ANT", "CIS", "ICA", "NCC"];

// Sell price options
const SELL_AT_OPTIONS = [
  { display: "Bid", value: "bid" },
  { display: "Ask", value: "ask" },
  { display: "PP7", value: "pp7" },
];

export default function BestRecipesClient() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BestRecipeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<keyof BestRecipeResult>("ticker");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [filterText, setFilterText] = useState("");
  const [selectedFilterGroupId, setSelectedFilterGroupId] = useState<string>("all");
  const [selectedBuilding, setSelectedBuilding] = useState<string>("all");
  const [exchange, setExchange] = useState<string>("ANT");
  const [sellAt, setSellAt] = useState<string>("bid");
  const [extractionMode, setExtractionMode] = useState<boolean>(false);
  const [readmeCollapsed, setReadmeCollapsed] = useState<boolean>(false);

  // Read exchange, sellAt, and extractionMode from URL params on mount
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
    const sellAtParam = params.get("sellAt")?.toLowerCase();
    if (sellAtParam) {
      const validSellAt = SELL_AT_OPTIONS.find(opt => opt.value === sellAtParam);
      if (validSellAt) {
        setSellAt(validSellAt.value);
      }
    }
    const extractionModeParam = params.get("extractionMode");
    if (extractionModeParam === "true") {
      setExtractionMode(true);
    }
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Update URL with current exchange, sellAt, and extractionMode
      const url = new URL(window.location.href);
      url.searchParams.set("exchange", exchange);
      url.searchParams.set("sellAt", sellAt);
      if (extractionMode) {
        url.searchParams.set("extractionMode", "true");
      } else {
        url.searchParams.delete("extractionMode");
      }
      window.history.replaceState({}, "", url);

      // Add a longer timeout for this computation-heavy request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 min timeout

      const qs = new URLSearchParams({ exchange, sellAt });
      if (extractionMode) {
        qs.set("extractionMode", "true");
      }
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

  // Extract unique buildings for dropdown
  const uniqueBuildings = useMemo(() => {
    const buildings = new Set<string>();
    data.forEach((row) => {
      if (row.building) buildings.add(row.building);
    });
    return ["all", ...Array.from(buildings).sort()];
  }, [data]);

  // Filter and sort data
  // First, apply ticker group filter
  const selectedGroup = tickerFilterGroups.find(g => g.id === selectedFilterGroupId);
  const groupFilteredData = selectedGroup?.tickers
    ? data.filter((row) => selectedGroup.tickers!.includes(row.ticker))
    : data; // If tickers is null (All), show all data

  // Second, apply building filter
  const buildingFilteredData = selectedBuilding === "all"
    ? groupFilteredData
    : groupFilteredData.filter((row) => row.building === selectedBuilding);

  // Then, apply text search within the filtered results (ticker name only)
  // Support exact match when wrapped in quotes: "C" matches only C, not CRU
  const trimmedFilter = filterText.trim();
  const isExactMatch = trimmedFilter.startsWith('"') && trimmedFilter.endsWith('"') && trimmedFilter.length > 1;
  const searchTerm = isExactMatch
    ? trimmedFilter.slice(1, -1) // Remove quotes
    : trimmedFilter;

  const filteredData = buildingFilteredData.filter((row) =>
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
    <>
      {/* Header Section */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: readmeCollapsed ? 0 : "1rem" }}>
          <h1 className="terminal-header" style={{ margin: 0, fontSize: "1.2rem", flex: 1, paddingBottom: 0, border: "none" }}>
            BEST RECIPE DATABASE // {exchange} // SELL_AT_{sellAt.toUpperCase()}
            {extractionMode && exchange === "ANT" && <span style={{ color: "var(--color-warning)" }}> // EXTRACTION_MODE</span>}
          </h1>
          <button
            onClick={() => setReadmeCollapsed(!readmeCollapsed)}
            className="terminal-button"
            style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem", marginLeft: "1rem" }}
          >
            {readmeCollapsed ? "[+] SHOW" : "[-] HIDE"}
          </button>
        </div>
        {!readmeCollapsed && (
          <p style={{ marginTop: "1rem", marginBottom: 0, color: "var(--color-text-secondary)", fontSize: "0.875rem", lineHeight: "1.6" }}>
            This tool determines the best production recipe for each ticker on the {exchange} exchange, calculated in dependency order using streamlined pruning;
            results may differ slightly from a full analysis done on the main page.
            Inputs are always purchased at <span className="text-accent">Ask</span> price, and outputs are sold at the price type chosen by the user.
            Each ticker shows its optimal recipe ID, scenario, profit per area (P/A), and the P/A if all inputs are bought (Buy All P/A).
            <span className="text-mono" style={{ display: "block", marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              Data refreshed hourly from FIO price feeds.
            </span>
          </p>
        )}
      </div>

      {/* Exchange Selection */}
      <div className="terminal-box" style={{ marginBottom: "1.5rem" }}>
        <div className="terminal-header" style={{ marginBottom: "1rem" }}>Exchange Selection</div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {EXCHANGE_DISPLAYS.map((exConfig) => (
            <a
              key={exConfig.display}
              href={`?exchange=${exConfig.display}&sellAt=${sellAt}`}
              onClick={(e) => {
                e.preventDefault();
                setExchange(exConfig.display);
              }}
              className="terminal-button"
              style={{
                textDecoration: "none",
                padding: "0.5rem 1.5rem",
                opacity: exchange === exConfig.display ? 1 : 0.7,
                background: exchange === exConfig.display ? "var(--color-accent-primary)" : "var(--color-bg-tertiary)",
                color: exchange === exConfig.display ? "var(--color-bg-primary)" : "var(--color-accent-primary)",
                borderColor: exchange === exConfig.display ? "var(--color-accent-primary)" : "var(--color-border-primary)"
              }}
            >
              {exConfig.display}
            </a>
          ))}
        </div>
      </div>

      {/* Sell At Selection */}
      <div className="terminal-box" style={{ marginBottom: "1.5rem" }}>
        <div className="terminal-header" style={{ marginBottom: "1rem" }}>Price Type Selection</div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {SELL_AT_OPTIONS.map((option) => (
            <a
              key={option.value}
              href={`?exchange=${exchange}&sellAt=${option.value}`}
              onClick={(e) => {
                e.preventDefault();
                setSellAt(option.value);
              }}
              className="terminal-button"
              style={{
                textDecoration: "none",
                padding: "0.5rem 1.5rem",
                opacity: sellAt === option.value ? 1 : 0.7,
                background: sellAt === option.value ? "var(--color-success)" : "var(--color-bg-tertiary)",
                color: sellAt === option.value ? "var(--color-bg-primary)" : "var(--color-success)",
                borderColor: sellAt === option.value ? "var(--color-success)" : "var(--color-border-primary)"
              }}
            >
              {option.display}
            </a>
          ))}
        </div>
      </div>

      {/* Extraction Mode Toggle (ANT only) */}
      {exchange === "ANT" && (
        <div className="terminal-box" style={{ marginBottom: "1.5rem" }}>
          <div className="terminal-header" style={{ marginBottom: "1rem" }}>Extraction Mode</div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={() => setExtractionMode(false)}
              className="terminal-button"
              style={{
                padding: "0.5rem 1.5rem",
                opacity: !extractionMode ? 1 : 0.7,
                background: !extractionMode ? "var(--color-info)" : "var(--color-bg-tertiary)",
                color: !extractionMode ? "var(--color-bg-primary)" : "var(--color-info)",
                borderColor: !extractionMode ? "var(--color-info)" : "var(--color-border-primary)"
              }}
            >
              Standard
            </button>
            <button
              onClick={() => setExtractionMode(true)}
              className="terminal-button"
              style={{
                padding: "0.5rem 1.5rem",
                opacity: extractionMode ? 1 : 0.7,
                background: extractionMode ? "var(--color-warning)" : "var(--color-bg-tertiary)",
                color: extractionMode ? "var(--color-bg-primary)" : "var(--color-warning)",
                borderColor: extractionMode ? "var(--color-warning)" : "var(--color-border-primary)"
              }}
            >
              Extraction
            </button>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginLeft: "0.5rem" }}>
              {extractionMode
                ? "Includes planet-specific extraction recipes for raw materials"
                : "Standard recipes only (buy raw materials from market)"}
            </span>
          </div>
        </div>
      )}

      {/* Loading Indicator */}
      {loading && (
        <div className="terminal-box" style={{ borderColor: "var(--color-warning)", marginBottom: "1.5rem" }}>
          <div className="status-warning terminal-loading" style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem" }}>
            <strong>PROCESSING RECIPES</strong>
          </div>
        </div>
      )}

      {/* Controls Section */}
      <div className="terminal-box" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", gap: "1rem", marginBottom: data.length > 0 ? "1rem" : 0, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={loadData}
            disabled={loading}
            className="terminal-button"
            style={{ padding: "0.75rem 1.5rem" }}
          >
            {loading ? <span className="terminal-loading">Generating</span> : "Generate Best Recipes"}
          </button>

          {data.length > 0 && (
            <input
              type="text"
              placeholder='Filter by ticker (use "quotes" for exact match)'
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="terminal-input"
              style={{ flex: 1, maxWidth: "400px" }}
            />
          )}

          {data.length > 0 && uniqueBuildings.length > 1 && (
            <select
              value={selectedBuilding}
              onChange={(e) => setSelectedBuilding(e.target.value)}
              className="terminal-select"
              style={{ minWidth: "150px" }}
            >
              {uniqueBuildings.map((building) => (
                <option key={building} value={building}>
                  {building === "all" ? "All Buildings" : building}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Ticker Group Filters */}
        {data.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--color-text-muted)", marginRight: "0.5rem" }}>
              FILTER:
            </span>
            {tickerFilterGroups.map((group) => (
              <button
                key={group.id}
                onClick={() => setSelectedFilterGroupId(group.id)}
                className="terminal-button"
                style={{
                  padding: "0.35rem 0.75rem",
                  fontSize: "0.75rem",
                  opacity: selectedFilterGroupId === group.id ? 1 : 0.6,
                  background: selectedFilterGroupId === group.id ? "var(--color-accent-secondary)" : "var(--color-bg-elevated)",
                  color: selectedFilterGroupId === group.id ? "var(--color-bg-primary)" : "var(--color-accent-primary)",
                  borderColor: selectedFilterGroupId === group.id ? "var(--color-accent-secondary)" : "var(--color-border-primary)"
                }}
              >
                {group.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="terminal-box" style={{ borderColor: "var(--color-error)", marginBottom: "1.5rem" }}>
          <div className="status-error" style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem" }}>
            ERROR: {error}
          </div>
        </div>
      )}

      {/* Results Count */}
      {data.length > 0 && (
        <div className="terminal-box" style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
            <span className="text-accent">SHOWING:</span> {sortedData.length} ticker{sortedData.length !== 1 ? 's' : ''}
            {selectedBuilding !== 'all' && <span> (building: {selectedBuilding})</span>}
            {selectedFilterGroupId !== 'all' && <span> (from {groupFilteredData.length} in {selectedGroup?.label})</span>}
            {data.length > sortedData.length && <span> out of {data.length} total</span>}
          </div>
        </div>
      )}

      {/* Data Table */}
      {data.length > 0 && (
        <div className="terminal-box">
          <div style={{ overflowX: "auto" }}>
            <table className="terminal-table">
              <thead>
                <tr>
                  {["ticker", "recipeId", "scenario", "profitPA", "buyAllProfitPA"].map((col) => (
                    <th
                      key={col}
                      onClick={() => handleSort(col as keyof BestRecipeResult)}
                      style={{
                        cursor: "pointer",
                        userSelect: "none",
                        textAlign: ["ticker", "recipeId", "profitPA", "buyAllProfitPA"].includes(col) ? "center" : undefined,
                        width: col !== "scenario" ? "1%" : undefined,
                        whiteSpace: "nowrap"
                      }}
                    >
                      {col === "ticker" && "Ticker"}
                      {col === "recipeId" && "RecipeID"}
                      {col === "scenario" && "Scenario"}
                      {col === "profitPA" && "Profit P/A"}
                      {col === "buyAllProfitPA" && "Buy All P/A"}
                      {sortColumn === col && (
                        <span style={{ marginLeft: "0.5rem" }}>
                          {sortDirection === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                    </th>
                  ))}
                  <th style={{ textAlign: "center", whiteSpace: "nowrap", width: "1%" }}>Analysis</th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map((row, idx) => (
                  <tr key={`${row.ticker}-${idx}`}>
                    <td style={{ fontWeight: "bold", color: "var(--color-accent-primary)", textAlign: "center", width: "1%", whiteSpace: "nowrap" }}>
                      {row.ticker}
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", textAlign: "center", width: "1%", whiteSpace: "nowrap" }}>
                      {row.recipeId || <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                    </td>
                    <td
                      style={{ fontSize: "0.875rem", maxWidth: "400px", cursor: "help" }}
                      title={row.scenario || ""}
                    >
                      {row.scenario ? scenarioDisplayName(row.scenario) : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                    </td>
                    <td style={{ textAlign: "center", fontFamily: "var(--font-mono)", width: "1%", whiteSpace: "nowrap" }}>
                      {typeof row.profitPA === "number" && Number.isFinite(row.profitPA)
                        ? <span className={row.profitPA >= 0 ? "status-success" : "status-error"}>{formatProfitPerArea(row.profitPA, exchange as Exchange)}</span>
                        : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                    </td>
                    <td style={{ textAlign: "center", fontFamily: "var(--font-mono)", width: "1%", whiteSpace: "nowrap" }}>
                      {row.buyAllProfitPA === null
                        ? <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>Input N/A</span>
                        : typeof row.buyAllProfitPA === "number" && Number.isFinite(row.buyAllProfitPA)
                        ? <span className={row.buyAllProfitPA >= 0 ? "status-success" : "status-error"}>{formatProfitPerArea(row.buyAllProfitPA, exchange as Exchange)}</span>
                        : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                    </td>
                    <td style={{ textAlign: "center", width: "1%", whiteSpace: "nowrap" }}>
                      <a
                        href={`/?ticker=${encodeURIComponent(row.ticker)}`}
                        className="terminal-button"
                        style={{
                          textDecoration: "none",
                          padding: "0.25rem 0.75rem",
                          fontSize: "0.75rem",
                          display: "inline-block"
                        }}
                      >
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && data.length === 0 && !error && (
        <div className="terminal-box" style={{ textAlign: "center", padding: "3rem 1rem" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
            <span className="text-accent" style={{ display: "block", marginBottom: "1rem", fontSize: "1.2rem" }}>
              [NO DATA]
            </span>
            Click "Generate Best Recipes" to calculate optimal recipes for all tickers.
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { usePersistedSettings } from "@/hooks/usePersistedSettings";

const EXCHANGE_OPTIONS = [
  { code: "AI1", label: "Antares Station (AI1)" },
  { code: "NC1", label: "Moria Station (NC1)" },
  { code: "CI1", label: "Benten Station (CI1)" },
  { code: "IC1", label: "Hortus Station (IC1)" },
];

const EXCHANGE_LOCATION: Record<string, string> = {
  AI1: "Antares Station",
  NC1: "Moria Station",
  CI1: "Benten Station",
  IC1: "Hortus Station",
};

interface StorageItem {
  MaterialTicker: string;
  MaterialAmount: number;
  [key: string]: unknown;
}

interface StorageEntry {
  StorageId: string;
  StorageItems: StorageItem[];
  [key: string]: unknown;
}

interface WarehouseEntry {
  LocationName: string;
  StoreId: string;
  [key: string]: unknown;
}

interface RawData {
  warehouses: WarehouseEntry[];
  storage: StorageEntry[];
  exchangeData: unknown[];
  orders: unknown[];
}

interface DeficitRow {
  ticker: string;
  demand: number;
  onHand: number;
  deficit: number;
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export default function ResupplyClient() {
  const [rawData, setRawData] = useState<RawData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const [fioUsername, setFioUsername] = usePersistedSettings<string>(
    "prun:fio:username",
    "",
    { updateUrl: false }
  );
  const [fioApiKey, setFioApiKey] = usePersistedSettings<string>(
    "prun:fio:apiKey",
    "",
    { updateUrl: false }
  );
  const [selectedExchange, setSelectedExchange] = usePersistedSettings<string>(
    "prun:resupply:exchange",
    "AI1",
    { updateUrl: false }
  );
  const [targetDays, setTargetDays] = usePersistedSettings<string>(
    "prun:resupply:targetDays",
    "14",
    { updateUrl: false }
  );
  const [burnText, setBurnText] = useState("");

  const hasCredentials = fioUsername.trim() !== "" && fioApiKey.trim() !== "";
  const targetDaysNum = Math.max(1, parseInt(targetDays, 10) || 14);

  const fetchData = useCallback(async () => {
    if (!fioUsername.trim() || !fioApiKey.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/resupply", {
        headers: {
          "x-fio-username": fioUsername.trim(),
          "x-fio-api-key": fioApiKey.trim(),
        },
      });
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setRawData(json);
        setLastRefresh(new Date());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, [fioUsername, fioApiKey]);

  useEffect(() => {
    if (hasCredentials) fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Phase 2: Burn parsing + warehouse matching + deficit calculation ---
  const { deficitRows, parsedCount, warehouseWarning } = useMemo(() => {
    const empty = { deficitRows: [] as DeficitRow[], parsedCount: 0, warehouseWarning: "" };
    if (!burnText.trim()) return empty;

    // Step 1: Parse burn table
    const lines = burnText.trim().split("\n");
    const consumptionByTicker = new Map<string, number>();
    for (const line of lines) {
      const cols = line.split("\t");
      if (cols.length < 5) continue;
      const [planet, ticker, , burnPerDayStr] = cols;
      if (planet?.trim() !== "Overall") continue;
      const burnPerDay = parseFloat(burnPerDayStr);
      if (isNaN(burnPerDay) || burnPerDay >= 0) continue; // consumption only
      const demand = Math.abs(burnPerDay) * targetDaysNum;
      consumptionByTicker.set(
        ticker.trim(),
        (consumptionByTicker.get(ticker.trim()) || 0) + demand
      );
    }

    if (consumptionByTicker.size === 0) return empty;

    // Step 2: Get on-hand supply at selected exchange
    let warehouseWarning = "";
    const onHandMap = new Map<string, number>();

    if (rawData) {
      const locationName = EXCHANGE_LOCATION[selectedExchange];
      const warehouse = rawData.warehouses?.find(
        (w: WarehouseEntry) => w.LocationName === locationName
      );

      if (!warehouse) {
        warehouseWarning = `No warehouse found at ${locationName}. On-hand quantities will be 0.`;
      } else {
        const storageEntry = rawData.storage?.find(
          (s: StorageEntry) => s.StorageId === warehouse.StoreId
        );
        if (storageEntry?.StorageItems) {
          for (const item of storageEntry.StorageItems) {
            onHandMap.set(
              item.MaterialTicker,
              (onHandMap.get(item.MaterialTicker) || 0) + item.MaterialAmount
            );
          }
        }
      }
    }

    // Step 3: Compute deficits
    const deficitRows: DeficitRow[] = [];
    for (const [ticker, demand] of consumptionByTicker) {
      const onHand = onHandMap.get(ticker) || 0;
      const deficit = demand - onHand;
      deficitRows.push({ ticker, demand, onHand, deficit });
    }

    // Sort: items with deficit > 0 first (by deficit desc), then stocked items
    deficitRows.sort((a, b) => {
      if (a.deficit > 0 && b.deficit <= 0) return -1;
      if (a.deficit <= 0 && b.deficit > 0) return 1;
      if (a.deficit > 0 && b.deficit > 0) return b.deficit - a.deficit;
      return a.ticker.localeCompare(b.ticker);
    });

    return {
      deficitRows,
      parsedCount: consumptionByTicker.size,
      warehouseWarning,
    };
  }, [burnText, rawData, selectedExchange, targetDaysNum]);

  return (
    <>
      {/* Header */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <h1
          className="terminal-header"
          style={{ margin: 0, fontSize: "1.2rem" }}
        >
          RESUPPLY // BID_OPPORTUNITY_SCANNER
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
          Parses your burn data to find materials you need, checks warehouse
          supply, and compares ask vs. bid prices across exchanges to surface
          profitable bidding opportunities.
          <span
            className="text-mono"
            style={{
              display: "block",
              marginTop: "0.5rem",
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
            }}
          >
            Source: rest.fnar.net — warehouses + storage + exchange/all + cxos
          </span>
        </p>
      </div>

      {/* FIO Credentials */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <div className="terminal-header" style={{ marginBottom: "1rem" }}>
          FIO Credentials
        </div>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <input
            type="text"
            placeholder="FIO username"
            value={fioUsername}
            onChange={(e) => setFioUsername(e.target.value)}
            className="terminal-input"
            style={{ flex: 1, minWidth: "150px", maxWidth: "250px" }}
          />
          <input
            type="password"
            placeholder="FIO API key"
            value={fioApiKey}
            onChange={(e) => setFioApiKey(e.target.value)}
            className="terminal-input"
            style={{ flex: 2, minWidth: "250px", maxWidth: "450px" }}
          />
          {!hasCredentials && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
                color: "var(--color-text-muted)",
              }}
            >
              Enter your FIO username and API key
            </span>
          )}
        </div>
      </div>

      {/* Exchange Selector */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <div className="terminal-header" style={{ marginBottom: "1rem" }}>
          Exchange
        </div>
        <select
          value={selectedExchange}
          onChange={(e) => setSelectedExchange(e.target.value)}
          className="terminal-select"
        >
          {EXCHANGE_OPTIONS.map((ex) => (
            <option key={ex.code} value={ex.code}>
              {ex.label}
            </option>
          ))}
        </select>
      </div>

      {/* Burn Table + Target Days */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <div className="terminal-header" style={{ marginBottom: "1rem" }}>
          Burn Data
        </div>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: "1 1 400px" }}>
            <textarea
              placeholder="Paste burn table from game (select all rows in BUI BRA burn section, copy with Ctrl+C)"
              value={burnText}
              onChange={(e) => setBurnText(e.target.value)}
              className="terminal-input"
              rows={4}
              style={{
                width: "100%",
                resize: "vertical",
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
              }}
            />
            {burnText.trim() && (
              <div
                style={{
                  marginTop: "0.5rem",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.75rem",
                  color: parsedCount > 0
                    ? "var(--color-text-secondary)"
                    : "var(--color-error, #ff4444)",
                }}
              >
                {parsedCount > 0
                  ? `Parsed ${parsedCount} consumption items from Overall`
                  : "No consumption items found. Ensure burn table has Overall rows with negative Burn/day."}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.7rem",
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Target Days
            </label>
            <input
              type="number"
              min="1"
              value={targetDays}
              onChange={(e) => setTargetDays(e.target.value)}
              className="terminal-input"
              style={{ width: "80px", textAlign: "center" }}
            />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          marginBottom: "2rem",
          display: "flex",
          gap: "1rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={fetchData}
          disabled={loading || !hasCredentials}
          className="terminal-button"
          style={{ padding: "0.5rem 1.5rem" }}
        >
          {loading ? "Fetching..." : "Fetch Data"}
        </button>
        {lastRefresh && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
            }}
          >
            Last fetch: {lastRefresh.toLocaleTimeString()}
          </span>
        )}
        {rawData && (
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
        )}
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

      {/* Warehouse Warning */}
      {warehouseWarning && rawData && (
        <div
          className="terminal-box"
          style={{
            marginBottom: "2rem",
            borderColor: "var(--color-accent-primary)",
          }}
        >
          <div
            style={{
              color: "var(--color-accent-primary)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
            }}
          >
            [WARN] {warehouseWarning}
          </div>
        </div>
      )}

      {/* Deficit Table */}
      {deficitRows.length > 0 && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div className="terminal-header" style={{ marginBottom: "1rem" }}>
            Supply Deficits — {EXCHANGE_LOCATION[selectedExchange]} — {targetDaysNum} day target ({deficitRows.filter(r => r.deficit > 0).length} need resupply)
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
                  {["Ticker", "Demand", "On-Hand", "Deficit"].map((label, i) => (
                    <th
                      key={label}
                      style={{
                        padding: "0.5rem 0.75rem",
                        borderBottom: "1px solid var(--color-border-primary)",
                        fontSize: "0.75rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--color-text-secondary)",
                        textAlign: i === 0 ? "left" : "right",
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deficitRows.map((row) => {
                  const isStocked = row.deficit <= 0;
                  return (
                    <tr
                      key={row.ticker}
                      style={{
                        borderBottom: "1px solid var(--color-border-secondary, rgba(255,255,255,0.05))",
                        opacity: isStocked ? 0.4 : 1,
                      }}
                    >
                      <td
                        style={{
                          padding: "0.5rem 0.75rem",
                          color: "var(--color-accent-primary)",
                          fontWeight: "bold",
                        }}
                      >
                        {row.ticker}
                      </td>
                      <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>
                        {formatNumber(row.demand)}
                      </td>
                      <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>
                        {formatNumber(row.onHand)}
                      </td>
                      <td
                        style={{
                          padding: "0.5rem 0.75rem",
                          textAlign: "right",
                          color: isStocked
                            ? "var(--color-text-muted)"
                            : "var(--color-accent-primary)",
                          fontWeight: isStocked ? "normal" : "bold",
                        }}
                      >
                        {isStocked ? "Stocked" : formatNumber(row.deficit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Debug View */}
      {rawData && showDebug && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div className="terminal-header" style={{ marginBottom: "1rem" }}>
            Raw API Response
          </div>
          <pre
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.7rem",
              color: "var(--color-text-secondary)",
              overflow: "auto",
              maxHeight: "500px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {JSON.stringify(rawData, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}

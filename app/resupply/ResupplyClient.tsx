"use client";

import { useState, useEffect, useCallback } from "react";
import { usePersistedSettings } from "@/hooks/usePersistedSettings";

const EXCHANGE_OPTIONS = [
  { code: "AI1", label: "Antares Station (AI1)" },
  { code: "NC1", label: "Moria Station (NC1)" },
  { code: "CI1", label: "Benten Station (CI1)" },
  { code: "IC1", label: "Hortus Station (IC1)" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawData = Record<string, any>;

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

  const hasCredentials = fioUsername.trim() !== "" && fioApiKey.trim() !== "";

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

      {/* Data Summary */}
      {rawData && !showDebug && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div className="terminal-header" style={{ marginBottom: "1rem" }}>
            Data Loaded
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              color: "var(--color-text-secondary)",
              lineHeight: "1.8",
            }}
          >
            <div>
              Warehouses: {Array.isArray(rawData.warehouses) ? rawData.warehouses.length : 0} entries
            </div>
            <div>
              Storage: {Array.isArray(rawData.storage) ? rawData.storage.length : 0} entries
            </div>
            <div>
              Exchange tickers: {Array.isArray(rawData.exchangeData) ? rawData.exchangeData.length : 0} entries
            </div>
            <div>
              Open orders: {Array.isArray(rawData.orders) ? rawData.orders.length : 0} entries
            </div>
            <div
              style={{
                marginTop: "1rem",
                color: "var(--color-text-muted)",
                fontSize: "0.75rem",
              }}
            >
              Phase 1 complete. Burn table parsing and deficit calculation coming
              in Phase 2.
            </div>
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

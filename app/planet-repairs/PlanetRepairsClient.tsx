"use client";

import { useState, useCallback } from "react";
import { usePersistedSettings } from "@/hooks/usePersistedSettings";

interface PlanetRepairInfo {
  planetId: string;
  planetName: string;
  minCondition: number;
  daysSinceRepair: number;
}

interface ApiResponse {
  planets: PlanetRepairInfo[];
  error?: string;
}

type SortField = "planetId" | "daysSinceRepair";

export default function PlanetRepairsClient() {
  const [planets, setPlanets] = useState<PlanetRepairInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>("daysSinceRepair");
  const [sortAsc, setSortAsc] = useState(false);
  // Draft values while typing — committed on blur/Enter
  const [draftAges, setDraftAges] = useState<Record<string, string>>({});

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
  const [targetAges, setTargetAges] = usePersistedSettings<Record<string, number>>(
    "prun:repairs:targetAges",
    {},
    {
      updateUrl: false,
      serialize: (val) => JSON.stringify(val),
      deserialize: (str) => {
        try {
          return JSON.parse(str) as Record<string, number>;
        } catch {
          return null;
        }
      },
    }
  );

  const hasCredentials = fioUsername.trim() !== "" && fioApiKey.trim() !== "";

  const fetchData = useCallback(async () => {
    if (!fioUsername.trim() || !fioApiKey.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/planet-repairs", {
        headers: {
          "x-fio-username": fioUsername.trim(),
          "x-fio-api-key": fioApiKey.trim(),
        },
      });
      const json: ApiResponse = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setPlanets(json.planets);
        setLastRefresh(new Date());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, [fioUsername, fioApiKey]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(field === "planetId");
    }
  };

  // While typing: only update the draft display value
  const handleDraftChange = (planetId: string, value: string) => {
    setDraftAges((prev) => ({ ...prev, [planetId]: value }));
  };

  // On blur or Enter: commit the draft to targetAges
  const commitTargetAge = (planetId: string, value: string) => {
    const num = value.trim() === "" ? undefined : Number(value);
    const updated = { ...targetAges };
    if (num === undefined || isNaN(num)) {
      delete updated[planetId];
    } else {
      updated[planetId] = num;
    }
    setTargetAges(updated);
    // Clear draft so the input reflects the committed value
    setDraftAges((prev) => {
      const next = { ...prev };
      delete next[planetId];
      return next;
    });
  };

  const inputValue = (planetId: string) =>
    planetId in draftAges
      ? draftAges[planetId]
      : (targetAges[planetId]?.toString() ?? "");

  // Split into alert vs. normal using committed targetAges only
  const alertPlanets = planets
    .filter((p) => {
      const target = targetAges[p.planetId];
      return target !== undefined && p.daysSinceRepair >= target - 10;
    })
    .sort((a, b) => {
      const aUrgency = a.daysSinceRepair - (targetAges[a.planetId] ?? 0);
      const bUrgency = b.daysSinceRepair - (targetAges[b.planetId] ?? 0);
      return bUrgency - aUrgency;
    });

  const normalPlanets = planets.filter((p) => {
    const target = targetAges[p.planetId];
    return target === undefined || p.daysSinceRepair < target - 10;
  });

  const sortedNormal = [...normalPlanets].sort((a, b) => {
    if (sortField === "planetId") {
      return sortAsc
        ? a.planetId.localeCompare(b.planetId)
        : b.planetId.localeCompare(a.planetId);
    }
    const diff = a.daysSinceRepair - b.daysSinceRepair;
    return sortAsc ? diff : -diff;
  });

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortAsc ? " ▲" : " ▼") : "";

  const formatDays = (days: number) => days.toFixed(1);

  const daysUntilTarget = (p: PlanetRepairInfo) => {
    const target = targetAges[p.planetId];
    if (target === undefined) return "—";
    const remaining = target - p.daysSinceRepair;
    return remaining >= 0
      ? `${remaining.toFixed(1)}d`
      : `${Math.abs(remaining).toFixed(1)}d overdue`;
  };

  const urgencyClass = (p: PlanetRepairInfo) => {
    const target = targetAges[p.planetId];
    if (target === undefined) return "";
    if (p.daysSinceRepair >= target) return "status-error";
    return "status-warning";
  };

  const targetInput = (planetId: string) => (
    <input
      className="terminal-input"
      type="text"
      inputMode="numeric"
      value={inputValue(planetId)}
      onChange={(e) => handleDraftChange(planetId, e.target.value)}
      onBlur={(e) => commitTargetAge(planetId, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitTargetAge(planetId, (e.target as HTMLInputElement).value);
      }}
      style={{ width: 80, textAlign: "right", padding: "2px 6px" }}
    />
  );

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <h1 className="terminal-header" style={{ marginBottom: "1.5rem" }}>
        Planet Repair Tracker
      </h1>

      {/* Credentials */}
      <div className="terminal-box" style={{ marginBottom: "1.5rem" }}>
        <div style={{ marginBottom: "0.75rem", fontWeight: 600, color: "var(--color-accent-primary)" }}>
          FIO Credentials
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>Username</label>
            <input
              className="terminal-input"
              type="text"
              value={fioUsername}
              onChange={(e) => setFioUsername(e.target.value)}
              placeholder="FIO username"
              style={{ minWidth: 180 }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>API Key</label>
            <input
              className="terminal-input"
              type="password"
              value={fioApiKey}
              onChange={(e) => setFioApiKey(e.target.value)}
              placeholder="FIO API key"
              style={{ minWidth: 260 }}
            />
          </div>
          <button
            className="terminal-button"
            onClick={fetchData}
            disabled={loading || !hasCredentials}
          >
            {loading ? "Loading..." : "Fetch Data"}
          </button>
        </div>
        {!hasCredentials && (
          <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
            Enter your FIO username and API key to fetch planet building data.
          </div>
        )}
        {lastRefresh && (
          <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
            Last refreshed: {lastRefresh.toLocaleTimeString()}
          </div>
        )}
      </div>

      {error && (
        <div className="terminal-box status-error" style={{ marginBottom: "1.5rem" }}>
          Error: {error}
        </div>
      )}

      {loading && (
        <div className="terminal-loading" style={{ marginBottom: "1.5rem" }}>
          Fetching building data...
        </div>
      )}

      {planets.length > 0 && (
        <>
          {/* Alert section */}
          {alertPlanets.length > 0 && (
            <div className="terminal-box" style={{ marginBottom: "1.5rem", borderColor: "var(--color-status-error, #ff4444)" }}>
              <div style={{ marginBottom: "0.75rem", fontWeight: 600, color: "var(--color-status-error, #ff4444)" }}>
                Approaching Repair Target ({alertPlanets.length} planet{alertPlanets.length !== 1 ? "s" : ""})
              </div>
              <table className="terminal-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Planet</th>
                    <th style={{ textAlign: "right" }}>Days Since Repair</th>
                    <th style={{ textAlign: "right" }}>Target Age (days)</th>
                    <th style={{ textAlign: "right" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {alertPlanets.map((p) => (
                    <tr key={p.planetId}>
                      <td>{p.planetName}</td>
                      <td style={{ textAlign: "right" }} className={urgencyClass(p)}>
                        {formatDays(p.daysSinceRepair)}
                      </td>
                      <td style={{ textAlign: "right" }}>{targetInput(p.planetId)}</td>
                      <td style={{ textAlign: "right" }} className={urgencyClass(p)}>
                        {daysUntilTarget(p)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* All planets section */}
          <div className="terminal-box">
            <div style={{ marginBottom: "0.75rem", fontWeight: 600, color: "var(--color-accent-primary)" }}>
              All Planets ({sortedNormal.length})
            </div>
            <table className="terminal-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th
                    style={{ textAlign: "left", cursor: "pointer" }}
                    onClick={() => handleSort("planetId")}
                  >
                    Planet{sortIndicator("planetId")}
                  </th>
                  <th
                    style={{ textAlign: "right", cursor: "pointer" }}
                    onClick={() => handleSort("daysSinceRepair")}
                  >
                    Days Since Repair{sortIndicator("daysSinceRepair")}
                  </th>
                  <th style={{ textAlign: "right" }}>Target Age (days)</th>
                </tr>
              </thead>
              <tbody>
                {sortedNormal.map((p) => (
                  <tr key={p.planetId}>
                    <td>{p.planetName}</td>
                    <td style={{ textAlign: "right" }}>
                      {formatDays(p.daysSinceRepair)}
                    </td>
                    <td style={{ textAlign: "right" }}>{targetInput(p.planetId)}</td>
                  </tr>
                ))}
                {sortedNormal.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: "center", color: "var(--color-text-muted)" }}>
                      All planets are in the alert section.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

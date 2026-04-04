"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { usePersistedSettings } from "../../src/hooks/usePersistedSettings";
import type { PMMGRow, PMMGCorpRow, PMMGApiResponse } from "../api/pmmg/route";

type ViewMode = "player" | "corp";

type PlayerSortField = keyof Pick<
  PMMGRow,
  "username" | "corporation" | "bases" | "profit" | "volume" | "profitPerBase" | "volumePerBase"
>;

type CorpSortField = keyof Pick<
  PMMGCorpRow,
  "corporation" | "members" | "bases" | "profit" | "volume" | "profitPerBase" | "volumePerBase"
>;

const PLAYER_COLUMN_LABELS: Record<PlayerSortField, string> = {
  username: "Company",
  corporation: "Corp",
  bases: "Bases",
  profit: "Profit",
  volume: "Volume",
  profitPerBase: "Profit/Base",
  volumePerBase: "Volume/Base",
};

const CORP_COLUMN_LABELS: Record<CorpSortField, string> = {
  corporation: "Corporation",
  members: "Members",
  bases: "Bases",
  profit: "Profit",
  volume: "Volume",
  profitPerBase: "Profit/Base",
  volumePerBase: "Volume/Base",
};

const MONTH_ABBRS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatMonthLabel(code: string): string {
  const abbr = code.slice(0, 3);
  const yy = code.slice(3);
  const idx = MONTH_ABBRS.indexOf(abbr);
  return idx >= 0 ? `${MONTH_NAMES[idx]} 20${yy}` : code;
}

function fmtC(value: number): string {
  return `ȼ${Math.round(value).toLocaleString()}`;
}

const PLAYER_STRING_FIELDS = new Set<PlayerSortField>(["username", "corporation"]);
const CORP_STRING_FIELDS = new Set<CorpSortField>(["corporation"]);

const PLAYER_SORT_FIELDS: PlayerSortField[] = [
  "username", "corporation", "bases", "profit", "volume", "profitPerBase", "volumePerBase",
];
const CORP_SORT_FIELDS: CorpSortField[] = [
  "corporation", "members", "bases", "profit", "volume", "profitPerBase", "volumePerBase",
];

export default function PMMGClient() {
  const [selectedMonth, setSelectedMonth] = usePersistedSettings<string>(
    "prun:pmmg:month",
    "",
    { urlParamName: "month", updateUrl: true }
  );

  const [minBases, setMinBases] = usePersistedSettings<string>(
    "prun:pmmg:minBases",
    "1",
    { updateUrl: false }
  );
  const [volumeLimit, setVolumeLimit] = usePersistedSettings<string>(
    "prun:pmmg:volumeLimit",
    "500",
    { updateUrl: false }
  );

  const [viewMode, setViewMode] = useState<ViewMode>("player");
  const [rows, setRows] = useState<PMMGRow[]>([]);
  const [corpRows, setCorpRows] = useState<PMMGCorpRow[]>([]);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [playerSortField, setPlayerSortField] = useState<PlayerSortField>("profitPerBase");
  const [playerSortAsc, setPlayerSortAsc] = useState(false);
  const [corpSortField, setCorpSortField] = useState<CorpSortField>("profitPerBase");
  const [corpSortAsc, setCorpSortAsc] = useState(false);

  const fetchData = useCallback(
    async (month?: string) => {
      setLoading(true);
      setError(null);
      try {
        const url = month ? `/api/pmmg?month=${encodeURIComponent(month)}` : "/api/pmmg";
        const res = await fetch(url);
        const json: PMMGApiResponse = await res.json();
        if (json.error) {
          setError(json.error);
        } else {
          setRows(json.rows);
          setCorpRows(json.corpRows ?? []);
          setAvailableMonths(json.availableMonths);
          if (!month) setSelectedMonth(json.month);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch");
      } finally {
        setLoading(false);
      }
    },
    [setSelectedMonth]
  );

  useEffect(() => {
    fetchData(selectedMonth || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMonthChange = (monthCode: string) => {
    setSelectedMonth(monthCode);
    fetchData(monthCode);
  };

  const handlePlayerSort = (field: PlayerSortField) => {
    if (playerSortField === field) {
      setPlayerSortAsc((prev) => !prev);
    } else {
      setPlayerSortField(field);
      setPlayerSortAsc(PLAYER_STRING_FIELDS.has(field));
    }
  };

  const handleCorpSort = (field: CorpSortField) => {
    if (corpSortField === field) {
      setCorpSortAsc((prev) => !prev);
    } else {
      setCorpSortField(field);
      setCorpSortAsc(CORP_STRING_FIELDS.has(field));
    }
  };

  const sortedPlayerRows = useMemo(() => {
    const limit = Math.max(1, parseInt(volumeLimit, 10) || 500);
    const minB = Math.max(0, parseInt(minBases, 10) || 0);

    const byVolume = [...rows]
      .sort((a, b) => b.volume - a.volume)
      .slice(0, limit);

    const filtered = minB > 0 ? byVolume.filter((r) => r.bases >= minB) : byVolume;

    return filtered.sort((a, b) => {
      let cmp = 0;
      if (playerSortField === "username") {
        cmp = a.username.localeCompare(b.username);
      } else if (playerSortField === "corporation") {
        cmp = (a.corporation ?? "").localeCompare(b.corporation ?? "");
      } else {
        cmp = (a[playerSortField] as number) - (b[playerSortField] as number);
      }
      return playerSortAsc ? cmp : -cmp;
    });
  }, [rows, playerSortField, playerSortAsc, volumeLimit, minBases]);

  const sortedCorpRows = useMemo(() => {
    return [...corpRows].sort((a, b) => {
      let cmp = 0;
      if (corpSortField === "corporation") {
        cmp = a.corporation.localeCompare(b.corporation);
      } else {
        cmp = (a[corpSortField] as number) - (b[corpSortField] as number);
      }
      return corpSortAsc ? cmp : -cmp;
    });
  }, [corpRows, corpSortField, corpSortAsc]);

  const playerSortIndicator = (field: PlayerSortField) =>
    playerSortField === field ? (playerSortAsc ? " ▲" : " ▼") : "";

  const corpSortIndicator = (field: CorpSortField) =>
    corpSortField === field ? (corpSortAsc ? " ▲" : " ▼") : "";

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h1
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--color-accent-primary)",
          fontSize: "1.25rem",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "1.5rem",
        }}
      >
        PMMG Leaderboard
      </h1>

      {/* View mode toggle */}
      <div style={{ marginBottom: "1.5rem", display: "flex", gap: "0.5rem" }}>
        <button
          className="terminal-button"
          onClick={() => setViewMode("player")}
          style={{ opacity: viewMode === "player" ? 1 : 0.5 }}
        >
          Player
        </button>
        <button
          className="terminal-button"
          onClick={() => setViewMode("corp")}
          style={{ opacity: viewMode === "corp" ? 1 : 0.5 }}
        >
          Corp
        </button>
      </div>

      <div className="terminal-box" style={{ marginBottom: "1.5rem", padding: "1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: "0.875rem",
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            Month
          </span>
          <select
            className="terminal-select"
            value={selectedMonth}
            onChange={(e) => handleMonthChange(e.target.value)}
            disabled={loading || availableMonths.length === 0}
          >
            {availableMonths.length === 0 && (
              <option value="">Loading...</option>
            )}
            {availableMonths.map((code) => (
              <option key={code} value={code}>
                {formatMonthLabel(code)}
              </option>
            ))}
          </select>
          {viewMode === "player" && (
            <>
              <span
                style={{
                  fontSize: "0.875rem",
                  color: "var(--color-text-muted)",
                  fontFamily: "var(--font-mono)",
                  marginLeft: "0.5rem",
                }}
              >
                Top N by volume
              </span>
              <input
                type="number"
                className="terminal-input"
                value={volumeLimit}
                min={1}
                max={500}
                onChange={(e) => setVolumeLimit(e.target.value)}
                style={{ width: "5rem" }}
              />
              <span
                style={{
                  fontSize: "0.875rem",
                  color: "var(--color-text-muted)",
                  fontFamily: "var(--font-mono)",
                  marginLeft: "0.5rem",
                }}
              >
                Min bases
              </span>
              <input
                type="number"
                className="terminal-input"
                value={minBases}
                min={0}
                onChange={(e) => setMinBases(e.target.value)}
                style={{ width: "5rem" }}
              />
            </>
          )}
          <button
            className="terminal-button"
            onClick={() => fetchData(selectedMonth || undefined)}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div
          className="terminal-box"
          style={{
            marginBottom: "1.5rem",
            padding: "1rem",
            color: "var(--color-error)",
            borderColor: "var(--color-error)",
          }}
        >
          Error: {error}
        </div>
      )}

      {loading && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            color: "var(--color-text-muted)",
            marginBottom: "1.5rem",
          }}
        >
          Fetching PMMG data...
        </div>
      )}

      {/* Player leaderboard */}
      {viewMode === "player" && !loading && rows.length > 0 && (
        <div className="terminal-box" style={{ padding: "1rem" }}>
          <div
            style={{
              marginBottom: "0.75rem",
              fontFamily: "var(--font-mono)",
              fontSize: "0.875rem",
              color: "var(--color-accent-primary)",
              fontWeight: 600,
            }}
          >
            Top {sortedPlayerRows.length} Companies — {formatMonthLabel(selectedMonth)}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="terminal-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>#</th>
                  {PLAYER_SORT_FIELDS.map((field) => (
                    <th
                      key={field}
                      style={{
                        textAlign: PLAYER_STRING_FIELDS.has(field) ? "left" : "right",
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                      onClick={() => handlePlayerSort(field)}
                    >
                      {PLAYER_COLUMN_LABELS[field]}
                      {playerSortIndicator(field)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPlayerRows.map((row, i) => (
                  <tr key={`${row.username}-${i}`}>
                    <td style={{ color: "var(--color-text-muted)", textAlign: "left" }}>
                      {i + 1}
                    </td>
                    <td style={{ textAlign: "left" }}>{row.username}</td>
                    <td
                      style={{
                        textAlign: "left",
                        color: row.corporation ? "var(--color-text-secondary)" : "var(--color-text-muted)",
                      }}
                    >
                      {row.corporation ?? "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>{row.bases.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>{fmtC(row.profit)}</td>
                    <td style={{ textAlign: "right" }}>{fmtC(row.volume)}</td>
                    <td style={{ textAlign: "right" }}>{fmtC(row.profitPerBase)}</td>
                    <td style={{ textAlign: "right" }}>{fmtC(row.volumePerBase)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Corp leaderboard */}
      {viewMode === "corp" && !loading && corpRows.length > 0 && (
        <div className="terminal-box" style={{ padding: "1rem" }}>
          <div
            style={{
              marginBottom: "0.75rem",
              fontFamily: "var(--font-mono)",
              fontSize: "0.875rem",
              color: "var(--color-accent-primary)",
              fontWeight: 600,
            }}
          >
            {sortedCorpRows.length} Corporations — {formatMonthLabel(selectedMonth)}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="terminal-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>#</th>
                  {CORP_SORT_FIELDS.map((field) => (
                    <th
                      key={field}
                      style={{
                        textAlign: CORP_STRING_FIELDS.has(field) ? "left" : "right",
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                      onClick={() => handleCorpSort(field)}
                    >
                      {CORP_COLUMN_LABELS[field]}
                      {corpSortIndicator(field)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedCorpRows.map((row, i) => (
                  <tr key={`${row.corporation}-${i}`}>
                    <td style={{ color: "var(--color-text-muted)", textAlign: "left" }}>
                      {i + 1}
                    </td>
                    <td style={{ textAlign: "left" }}>{row.corporation}</td>
                    <td style={{ textAlign: "right" }}>{row.members.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>{row.bases.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>{fmtC(row.profit)}</td>
                    <td style={{ textAlign: "right" }}>{fmtC(row.volume)}</td>
                    <td style={{ textAlign: "right" }}>{fmtC(row.profitPerBase)}</td>
                    <td style={{ textAlign: "right" }}>{fmtC(row.volumePerBase)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

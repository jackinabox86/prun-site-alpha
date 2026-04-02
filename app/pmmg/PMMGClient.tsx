"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { usePersistedSettings } from "../../src/hooks/usePersistedSettings";
import type { PMMGRow, PMMGApiResponse } from "../api/pmmg/route";

type SortField = keyof Pick<
  PMMGRow,
  "username" | "corporation" | "bases" | "profit" | "volume" | "profitPerBase" | "volumePerBase"
>;

const COLUMN_LABELS: Record<SortField, string> = {
  username: "Company",
  corporation: "Corp",
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

const STRING_FIELDS = new Set<SortField>(["username", "corporation"]);

export default function PMMGClient() {
  const [selectedMonth, setSelectedMonth] = usePersistedSettings<string>(
    "prun:pmmg:month",
    "",
    { urlParamName: "month", updateUrl: true }
  );

  const [rows, setRows] = useState<PMMGRow[]>([]);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("profitPerBase");
  const [sortAsc, setSortAsc] = useState(false);

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

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(STRING_FIELDS.has(field));
    }
  };

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortField === "username") {
        cmp = a.username.localeCompare(b.username);
      } else if (sortField === "corporation") {
        cmp = (a.corporation ?? "").localeCompare(b.corporation ?? "");
      } else {
        cmp = (a[sortField] as number) - (b[sortField] as number);
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, sortField, sortAsc]);

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortAsc ? " ▲" : " ▼") : "";

  const SORT_FIELDS: SortField[] = [
    "username", "corporation", "bases", "profit", "volume", "profitPerBase", "volumePerBase",
  ];

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

      {!loading && rows.length > 0 && (
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
            Top {rows.length} Companies — {formatMonthLabel(selectedMonth)}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="terminal-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>#</th>
                  {SORT_FIELDS.map((field) => (
                    <th
                      key={field}
                      style={{
                        textAlign: STRING_FIELDS.has(field) ? "left" : "right",
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                      onClick={() => handleSort(field)}
                    >
                      {COLUMN_LABELS[field]}
                      {sortIndicator(field)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => (
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
    </div>
  );
}

"use client";

import { useState, useEffect, useMemo } from "react";
import type { BasesRankingRow, BasesRankingResponse } from "../api/bases-ranking/route";

type SortField = "rank" | "username" | "companyName" | "corporation" | "bases" | "daysActive" | "daysPerBase";
type SortDir = "asc" | "desc";

const COLUMN_LABELS: Record<SortField, string> = {
  rank: "#",
  username: "Username",
  companyName: "Company",
  corporation: "Corp",
  bases: "Bases",
  daysActive: "Days Active",
  daysPerBase: "Days / Base",
};

const STRING_FIELDS = new Set<SortField>(["username", "companyName", "corporation"]);

export default function BasesRankingClient() {
  const [rows, setRows] = useState<BasesRankingRow[]>([]);
  const [snapshotDate, setSnapshotDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [minBases, setMinBases] = useState("1");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/bases-ranking")
      .then((r) => r.json())
      .then((data: BasesRankingResponse) => {
        if (data.error) {
          setError(data.error);
        } else {
          setRows(data.rows ?? []);
          setSnapshotDate(data.snapshotDate ?? "");
        }
      })
      .catch(() => setError("Failed to load data."))
      .finally(() => setLoading(false));
  }, []);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "rank" || field === "daysPerBase" ? "asc" : "desc");
    }
  }

  const filtered = useMemo(() => {
    const minB = parseInt(minBases, 10) || 1;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.bases < minB) return false;
      if (q) {
        return (
          r.username.toLowerCase().includes(q) ||
          r.companyName.toLowerCase().includes(q) ||
          (r.corporation ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [rows, minBases, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      let cmp: number;
      if (STRING_FIELDS.has(sortField)) {
        cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      } else {
        cmp = (av as number) - (bv as number);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  function arrow(field: SortField) {
    if (field !== sortField) return " ↕";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  const thStyle: React.CSSProperties = {
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h1
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--color-accent-primary)",
          fontSize: "1.25rem",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "0.5rem",
        }}
      >
        Bases Ranking
      </h1>
      {snapshotDate && (
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.75rem",
            color: "var(--color-text-muted)",
            marginBottom: "1.5rem",
          }}
        >
          Snapshot: {snapshotDate} &mdash; sorted by days per base (lower is more efficient)
        </p>
      )}

      <div className="terminal-box" style={{ marginBottom: "1.5rem", padding: "1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: "0.875rem",
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            Min bases
          </span>
          <input
            type="number"
            className="terminal-input"
            value={minBases}
            min={1}
            onChange={(e) => setMinBases(e.target.value)}
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
            Search
          </span>
          <input
            type="text"
            className="terminal-input"
            value={search}
            placeholder="username / company / corp"
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "16rem" }}
          />
          <span
            style={{
              fontSize: "0.875rem",
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-mono)",
              marginLeft: "auto",
            }}
          >
            {sorted.length} players
          </span>
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

      {loading ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            color: "var(--color-text-muted)",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          Loading...
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="terminal-table">
            <thead>
              <tr>
                {(Object.keys(COLUMN_LABELS) as SortField[]).map((field) => (
                  <th key={field} style={thStyle} onClick={() => handleSort(field)}>
                    {COLUMN_LABELS[field]}
                    {arrow(field)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.username}>
                  <td style={{ color: "var(--color-text-muted)" }}>{row.rank}</td>
                  <td style={{ color: "var(--color-info)" }}>{row.username}</td>
                  <td style={{ color: "var(--color-text-secondary)" }}>{row.companyName}</td>
                  <td style={{ color: "var(--color-accent-tertiary)" }}>
                    {row.corporation ?? <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>{row.bases}</td>
                  <td style={{ textAlign: "right" }}>{row.daysActive.toLocaleString()}</td>
                  <td
                    style={{
                      textAlign: "right",
                      color: row.daysPerBase < 30
                        ? "var(--color-success)"
                        : row.daysPerBase < 60
                        ? "var(--color-warning)"
                        : "var(--color-text-secondary)",
                      fontWeight: row.daysPerBase < 30 ? 600 : undefined,
                    }}
                  >
                    {row.daysPerBase.toFixed(1)}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      textAlign: "center",
                      color: "var(--color-text-muted)",
                      padding: "2rem",
                    }}
                  >
                    No results.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

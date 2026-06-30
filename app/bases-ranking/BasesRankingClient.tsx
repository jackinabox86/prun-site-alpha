"use client";

import { useState, useEffect, useMemo } from "react";
import type { BasesRankingRow, BasesRankingResponse } from "../api/bases-ranking/route";

type SortField = keyof BasesRankingRow;
type SortDir = "asc" | "desc";

const COLUMN_LABELS: Record<SortField, string> = {
  rank: "#",
  username: "Username",
  companyName: "Company",
  companyCode: "Code",
  corporation: "Corp",
  bases: "Bases",
  daysActive: "Days",
  daysPerBase: "Days / Base",
};

const STRING_FIELDS = new Set<SortField>(["username", "companyName", "companyCode", "corporation"]);
const RIGHT_ALIGN_FIELDS = new Set<SortField>(["bases", "daysActive", "daysPerBase"]);

function nullableCmp(a: number | null, b: number | null, dir: SortDir) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === "asc" ? a - b : b - a;
}

export default function BasesRankingClient() {
  const [rows, setRows] = useState<BasesRankingRow[]>([]);
  const [snapshotDate, setSnapshotDate] = useState("");
  const [fioDataDate, setFioDataDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [minBases, setMinBases] = useState("1");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/bases-ranking")
      .then((r) => r.json())
      .then((data: BasesRankingResponse) => {
        if (data.error) setError(data.error);
        else {
          setRows(data.rows ?? []);
          setSnapshotDate(data.snapshotDate ?? "");
          setFioDataDate(data.fioDataDate ?? null);
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
      if (STRING_FIELDS.has(sortField)) {
        const cmp = String(a[sortField] ?? "").localeCompare(String(b[sortField] ?? ""));
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortField === "daysActive" || sortField === "daysPerBase") {
        return nullableCmp(
          a[sortField] as number | null,
          b[sortField] as number | null,
          sortDir
        );
      }
      const av = a[sortField] as number;
      const bv = b[sortField] as number;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [filtered, sortField, sortDir]);

  function arrow(f: SortField) {
    if (f !== sortField) return null;
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.875rem" };
  const thStyle = (f: SortField): React.CSSProperties => ({
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    textAlign: RIGHT_ALIGN_FIELDS.has(f) ? "center" : "left",
  });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-mono)", color: "var(--color-accent-primary)", fontSize: "1.25rem", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
        Bases Ranking
      </h1>
      <p style={{ ...mono, fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "1.5rem" }}>
        Snapshot: {snapshotDate || "…"}
        {fioDataDate && <> &mdash; FIO data: {new Date(fioDataDate).toLocaleDateString()}</>}
        {!fioDataDate && !loading && <> &mdash; <span style={{ color: "var(--color-warning)" }}>FIO data not yet generated (run fetch-fio-users)</span></>}
        {" "}&mdash; ranked by days per base (lower = more efficient)
      </p>

      <div className="terminal-box" style={{ marginBottom: "1.5rem", padding: "1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ ...mono, color: "var(--color-text-muted)" }}>Min bases</span>
          <input type="number" className="terminal-input" value={minBases} min={1}
            onChange={(e) => setMinBases(e.target.value)} style={{ width: "5rem" }} />
          <span style={{ ...mono, color: "var(--color-text-muted)", marginLeft: "0.5rem" }}>Search</span>
          <input type="text" className="terminal-input" value={search}
            placeholder="username / company / corp"
            onChange={(e) => setSearch(e.target.value)} style={{ width: "16rem" }} />
          <span style={{ ...mono, color: "var(--color-text-muted)", marginLeft: "auto" }}>
            {sorted.length} players
          </span>
        </div>
      </div>

      {error && (
        <div className="terminal-box" style={{ marginBottom: "1.5rem", padding: "1rem", color: "var(--color-error)", borderColor: "var(--color-error)" }}>
          Error: {error}
        </div>
      )}

      {loading ? (
        <div style={{ ...mono, color: "var(--color-text-muted)", padding: "2rem", textAlign: "center" }}>Loading…</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="terminal-table">
            <thead>
              <tr>
                {(Object.keys(COLUMN_LABELS) as SortField[]).map((f) => (
                  <th key={f} style={thStyle(f)} onClick={() => handleSort(f)}>
                    {COLUMN_LABELS[f]}{arrow(f)}
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
                    {row.companyCode ?? <span style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>—</span>}
                  </td>
                  <td style={{ color: "var(--color-text-muted)" }}>
                    {row.corporation ?? <span style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>—</span>}
                  </td>
                  <td style={{ textAlign: "center" }}>{row.bases}</td>
                  <td style={{ textAlign: "center", color: "var(--color-text-secondary)" }}>
                    {row.daysActive !== null
                      ? row.daysActive.toLocaleString()
                      : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {row.daysPerBase !== null ? (
                      <span style={{
                        color: row.daysPerBase < 30 ? "var(--color-success)"
                          : row.daysPerBase < 60 ? "var(--color-warning)"
                          : "var(--color-text-secondary)",
                        fontWeight: row.daysPerBase < 30 ? 600 : undefined,
                      }}>
                        {row.daysPerBase.toFixed(1)}
                      </span>
                    ) : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "2rem" }}>
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

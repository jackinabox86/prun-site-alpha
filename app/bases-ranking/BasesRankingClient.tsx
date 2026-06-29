"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import type { BasesRankingPublicRow, BasesRankingPublicResponse } from "../api/bases-ranking/route";

const API_KEY_STORAGE = "prun:fnar-api-key";
const FNAR_BASE = "https://rest.fnar.net";

interface FnarUser {
  UserName?: string;
  CompanyName?: string;
  Created?: string | number;
  CreatedEpochMs?: number;
  StartDate?: string | number;
  [key: string]: unknown;
}

interface DisplayRow {
  rank: number;
  username: string;
  companyName: string;
  corporation: string | null;
  bases: number;
  daysActive: number | null;
  daysPerBase: number | null;
}

type SortField = keyof DisplayRow;
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

function parseEpochMs(user: FnarUser): number | null {
  for (const v of [user.CreatedEpochMs, user.Created, user.StartDate]) {
    if (v == null) continue;
    if (typeof v === "number" && v > 0) return v < 1e12 ? v * 1000 : v;
    if (typeof v === "string") {
      const d = Date.parse(v);
      if (!isNaN(d)) return d;
    }
  }
  return null;
}

function nullableCmp(a: number | null, b: number | null, dir: SortDir) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === "asc" ? a - b : b - a;
}

export default function BasesRankingClient() {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [publicRows, setPublicRows] = useState<BasesRankingPublicRow[]>([]);
  const [displayRows, setDisplayRows] = useState<DisplayRow[]>([]);
  const [snapshotDate, setSnapshotDate] = useState("");
  const [loadingPublic, setLoadingPublic] = useState(true);
  const [loadingFnar, setLoadingFnar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fnarError, setFnarError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [minBases, setMinBases] = useState("1");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem(API_KEY_STORAGE) ?? "";
    setSavedKey(stored);
    setApiKeyInput(stored);
  }, []);

  useEffect(() => {
    fetch("/api/bases-ranking")
      .then((r) => r.json())
      .then((data: BasesRankingPublicResponse) => {
        if (data.error) setError(data.error);
        else {
          setPublicRows(data.rows ?? []);
          setSnapshotDate(data.snapshotDate ?? "");
        }
      })
      .catch(() => setError("Failed to load base data."))
      .finally(() => setLoadingPublic(false));
  }, []);

  const loadFnar = useCallback(async (key: string, rows: BasesRankingPublicRow[]) => {
    if (!key || rows.length === 0) return;
    setLoadingFnar(true);
    setFnarError(null);
    try {
      const res = await fetch(`${FNAR_BASE}/user/allusers`, {
        headers: { Authorization: key, accept: "application/json" },
      });
      if (!res.ok) {
        setFnarError(`FIO API returned ${res.status} — check your API key.`);
        return;
      }
      const allUsers: FnarUser[] | string[] = await res.json();
      const nowMs = Date.now();

      // Build lookup: username (lowercase) → enrichment data
      const lookup = new Map<string, { companyName: string; createdEpochMs: number | null }>();
      for (const u of allUsers) {
        if (typeof u === "string") continue; // endpoint returned plain strings — no enrichment available
        const name = u.UserName;
        if (!name) continue;
        lookup.set(name.toLowerCase(), {
          companyName: (u.CompanyName as string) || name,
          createdEpochMs: parseEpochMs(u),
        });
      }

      const built: DisplayRow[] = rows.map((pr) => {
        const enriched = lookup.get(pr.username.toLowerCase());
        const companyName = enriched?.companyName ?? pr.username;
        let daysActive: number | null = null;
        if (enriched?.createdEpochMs != null) {
          const d = Math.floor((nowMs - enriched.createdEpochMs) / (1000 * 60 * 60 * 24));
          if (d >= 0) daysActive = d;
        }
        return {
          rank: 0,
          username: pr.username,
          companyName,
          corporation: pr.corporation,
          bases: pr.bases,
          daysActive,
          daysPerBase: daysActive !== null ? daysActive / pr.bases : null,
        };
      });

      built.sort((a, b) => {
        if (a.daysPerBase === null && b.daysPerBase === null) return 0;
        if (a.daysPerBase === null) return 1;
        if (b.daysPerBase === null) return -1;
        return a.daysPerBase - b.daysPerBase;
      });
      built.forEach((r, i) => { r.rank = i + 1; });
      setDisplayRows(built);
    } catch {
      setFnarError("Failed to reach FIO API. Check your network or API key.");
    } finally {
      setLoadingFnar(false);
    }
  }, []);

  useEffect(() => {
    if (!loadingPublic && publicRows.length > 0 && savedKey) {
      loadFnar(savedKey, publicRows);
    }
  }, [loadingPublic, publicRows, savedKey, loadFnar]);

  function saveKey() {
    const k = apiKeyInput.trim();
    localStorage.setItem(API_KEY_STORAGE, k);
    setSavedKey(k);
    if (k && publicRows.length > 0) loadFnar(k, publicRows);
  }

  function clearKey() {
    localStorage.removeItem(API_KEY_STORAGE);
    setSavedKey("");
    setApiKeyInput("");
    setDisplayRows([]);
  }

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
    return displayRows.filter((r) => {
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
  }, [displayRows, minBases, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (STRING_FIELDS.has(sortField)) {
        const cmp = String(a[sortField] ?? "").localeCompare(String(b[sortField] ?? ""));
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortField === "daysActive" || sortField === "daysPerBase") {
        return nullableCmp(a[sortField] as number | null, b[sortField] as number | null, sortDir);
      }
      const av = a[sortField] as number;
      const bv = b[sortField] as number;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [filtered, sortField, sortDir]);

  function arrow(f: SortField) {
    if (f !== sortField) return " ↕";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.875rem" };
  const thStyle: React.CSSProperties = { cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" };
  const loading = loadingPublic || loadingFnar;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-mono)", color: "var(--color-accent-primary)", fontSize: "1.25rem", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
        Bases Ranking
      </h1>
      {snapshotDate && (
        <p style={{ ...mono, fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "1.5rem" }}>
          Snapshot: {snapshotDate} &mdash; ranked by days per base (lower = more efficient)
        </p>
      )}

      <div className="terminal-box" style={{ marginBottom: "1.5rem", padding: "1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ ...mono, color: "var(--color-text-muted)" }}>FIO API Key</span>
          <input
            type="password"
            className="terminal-input"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveKey()}
            placeholder="paste your FIO API key"
            style={{ width: "22rem", fontFamily: "var(--font-mono)" }}
          />
          <button className="terminal-button" onClick={saveKey} disabled={loading}>
            {savedKey ? "Update" : "Save & Load"}
          </button>
          {savedKey && (
            <button className="terminal-button" onClick={clearKey} disabled={loading}
              style={{ color: "var(--color-error)", borderColor: "var(--color-error)" }}>
              Clear
            </button>
          )}
          {savedKey && !loading && !fnarError && (
            <span style={{ ...mono, fontSize: "0.75rem", color: "var(--color-success)" }}>✓ key stored locally</span>
          )}
        </div>
        {!savedKey && (
          <p style={{ ...mono, fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }}>
            Your key is stored only in your browser and never sent to this server.
          </p>
        )}
      </div>

      {fnarError && (
        <div className="terminal-box" style={{ marginBottom: "1.5rem", padding: "1rem", color: "var(--color-error)", borderColor: "var(--color-error)" }}>
          {fnarError}
        </div>
      )}
      {error && (
        <div className="terminal-box" style={{ marginBottom: "1.5rem", padding: "1rem", color: "var(--color-error)", borderColor: "var(--color-error)" }}>
          {error}
        </div>
      )}

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

      {loading ? (
        <div style={{ ...mono, color: "var(--color-text-muted)", padding: "2rem", textAlign: "center" }}>
          {loadingFnar ? "Loading FIO data…" : "Loading…"}
        </div>
      ) : !savedKey ? (
        <div style={{ ...mono, color: "var(--color-text-muted)", padding: "2rem", textAlign: "center" }}>
          Enter your FIO API key above to load the ranking.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="terminal-table">
            <thead>
              <tr>
                {(Object.keys(COLUMN_LABELS) as SortField[]).map((f) => (
                  <th key={f} style={thStyle} onClick={() => handleSort(f)}>
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
                    {row.corporation ?? <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>{row.bases}</td>
                  <td style={{ textAlign: "right", color: "var(--color-text-secondary)" }}>
                    {row.daysActive !== null ? row.daysActive.toLocaleString() : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {row.daysPerBase !== null ? (
                      <span style={{
                        color: row.daysPerBase < 30 ? "var(--color-success)" : row.daysPerBase < 60 ? "var(--color-warning)" : "var(--color-text-secondary)",
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
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "2rem" }}>
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

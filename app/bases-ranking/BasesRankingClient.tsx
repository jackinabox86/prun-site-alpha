"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { BasesRankingPublicRow, BasesRankingPublicResponse } from "../api/bases-ranking/route";

const API_KEY_STORAGE = "prun:fnar-api-key";
const USER_CACHE_STORAGE = "prun:fnar-user-cache-v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FNAR_BASE = "https://rest.fnar.net";
const CONCURRENCY = 8;

interface FnarUserData {
  companyName: string;
  createdEpochMs: number | null;
}

interface UserCache {
  timestamp: number;
  users: Record<string, FnarUserData | null>;
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

function loadCache(): UserCache {
  try {
    const raw = localStorage.getItem(USER_CACHE_STORAGE);
    if (raw) {
      const parsed: UserCache = JSON.parse(raw);
      if (Date.now() - parsed.timestamp < CACHE_TTL_MS) return parsed;
    }
  } catch { /* ignore */ }
  return { timestamp: Date.now(), users: {} };
}

function saveCache(cache: UserCache) {
  try {
    localStorage.setItem(USER_CACHE_STORAGE, JSON.stringify(cache));
  } catch { /* ignore */ }
}

function parseCreatedEpochMs(user: Record<string, unknown>): number | null {
  // Try known field names the FIO API might use
  for (const field of ["CreatedEpochMs", "Created", "StartDate", "RegistrationDate"]) {
    const v = user[field];
    if (v == null) continue;
    if (typeof v === "number" && v > 0) {
      return v < 1e12 ? v * 1000 : v;
    }
    if (typeof v === "string") {
      const d = Date.parse(v);
      if (!isNaN(d)) return d;
    }
  }
  return null;
}

async function fetchUserBatch(
  usernames: string[],
  apiKey: string,
  cache: UserCache,
  onProgress: (done: number) => void
): Promise<UserCache> {
  const uncached = usernames.filter((u) => !(u.toLowerCase() in cache.users));
  let done = usernames.length - uncached.length;
  onProgress(done);

  const queue = [...uncached];

  async function worker() {
    while (queue.length > 0) {
      const username = queue.shift()!;
      const key = username.toLowerCase();
      try {
        const res = await fetch(`${FNAR_BASE}/user/${encodeURIComponent(username)}`, {
          headers: { Authorization: apiKey, accept: "application/json" },
        });
        if (res.ok) {
          const data: Record<string, unknown> = await res.json();
          cache.users[key] = {
            companyName: (data.CompanyName as string) || username,
            createdEpochMs: parseCreatedEpochMs(data),
          };
        } else if (res.status === 204 || res.status === 404) {
          cache.users[key] = null;
        }
      } catch {
        // Network error — leave uncached, will retry next load
      }
      done++;
      onProgress(done);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  cache.timestamp = Date.now();
  saveCache(cache);
  return cache;
}

function buildDisplayRows(
  publicRows: BasesRankingPublicRow[],
  cache: UserCache
): DisplayRow[] {
  const nowMs = Date.now();
  const rows: DisplayRow[] = [];

  for (const pr of publicRows) {
    const cached = cache.users[pr.username.toLowerCase()];
    let companyName = pr.username;
    let daysActive: number | null = null;

    if (cached) {
      companyName = cached.companyName;
      if (cached.createdEpochMs !== null) {
        const d = Math.floor((nowMs - cached.createdEpochMs) / (1000 * 60 * 60 * 24));
        if (d >= 0) daysActive = d;
      }
    }

    rows.push({
      rank: 0,
      username: pr.username,
      companyName,
      corporation: pr.corporation,
      bases: pr.bases,
      daysActive,
      daysPerBase: daysActive !== null ? daysActive / pr.bases : null,
    });
  }

  rows.sort((a, b) => {
    if (a.daysPerBase === null && b.daysPerBase === null) return 0;
    if (a.daysPerBase === null) return 1;
    if (b.daysPerBase === null) return -1;
    return a.daysPerBase - b.daysPerBase;
  });
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

function nullableCmp(a: number | null, b: number | null, dir: SortDir) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === "asc" ? a - b : b - a;
}

export default function BasesRankingClient() {
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [publicRows, setPublicRows] = useState<BasesRankingPublicRow[]>([]);
  const [displayRows, setDisplayRows] = useState<DisplayRow[]>([]);
  const [snapshotDate, setSnapshotDate] = useState("");
  const [loadingPublic, setLoadingPublic] = useState(true);
  const [fetchProgress, setFetchProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [minBases, setMinBases] = useState("1");
  const [search, setSearch] = useState("");
  const cacheRef = useRef<UserCache>({ timestamp: 0, users: {} });

  // Load stored key on mount
  useEffect(() => {
    const stored = localStorage.getItem(API_KEY_STORAGE) ?? "";
    setApiKey(stored);
    setApiKeyInput(stored);
    cacheRef.current = loadCache();
  }, []);

  // Fetch public data
  useEffect(() => {
    setLoadingPublic(true);
    fetch("/api/bases-ranking")
      .then((r) => r.json())
      .then((data: BasesRankingPublicResponse) => {
        if (data.error) {
          setError(data.error);
        } else {
          setPublicRows(data.rows ?? []);
          setSnapshotDate(data.snapshotDate ?? "");
        }
      })
      .catch(() => setError("Failed to load base data."))
      .finally(() => setLoadingPublic(false));
  }, []);

  const enrichWithFnar = useCallback(
    async (rows: BasesRankingPublicRow[], key: string) => {
      if (!key || rows.length === 0) return;
      const usernames = rows.map((r) => r.username);
      const cache = cacheRef.current;
      setFetchProgress({ done: 0, total: usernames.length });
      const updated = await fetchUserBatch(usernames, key, cache, (done) => {
        setFetchProgress({ done, total: usernames.length });
      });
      cacheRef.current = updated;
      setDisplayRows(buildDisplayRows(rows, updated));
      setFetchProgress(null);
    },
    []
  );

  // When public rows load and key is present, enrich
  useEffect(() => {
    if (!loadingPublic && publicRows.length > 0 && apiKey) {
      // Build from cache immediately, then fill gaps
      setDisplayRows(buildDisplayRows(publicRows, cacheRef.current));
      enrichWithFnar(publicRows, apiKey);
    }
  }, [loadingPublic, publicRows, apiKey, enrichWithFnar]);

  function saveKey() {
    const k = apiKeyInput.trim();
    localStorage.setItem(API_KEY_STORAGE, k);
    setApiKey(k);
    // Clear cache so new key fetches fresh data
    cacheRef.current = { timestamp: Date.now(), users: {} };
    saveCache(cacheRef.current);
    setDisplayRows(buildDisplayRows(publicRows, cacheRef.current));
    if (k && publicRows.length > 0) enrichWithFnar(publicRows, k);
  }

  function clearKey() {
    localStorage.removeItem(API_KEY_STORAGE);
    localStorage.removeItem(USER_CACHE_STORAGE);
    setApiKey("");
    setApiKeyInput("");
    cacheRef.current = { timestamp: Date.now(), users: {} };
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

  const thStyle: React.CSSProperties = { cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" };
  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.875rem" };

  const isFetching = fetchProgress !== null;
  const fetchPct = fetchProgress
    ? Math.round((fetchProgress.done / fetchProgress.total) * 100)
    : 0;

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
        <p style={{ ...mono, fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "1.5rem" }}>
          Snapshot: {snapshotDate} &mdash; ranked by days per base (lower = more efficient)
        </p>
      )}

      {/* API Key panel */}
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
          <button className="terminal-button" onClick={saveKey} disabled={isFetching}>
            {apiKey ? "Update" : "Save & Load"}
          </button>
          {apiKey && (
            <button
              className="terminal-button"
              onClick={clearKey}
              style={{ color: "var(--color-error)", borderColor: "var(--color-error)" }}
            >
              Clear
            </button>
          )}
          {apiKey && !isFetching && (
            <span style={{ ...mono, fontSize: "0.75rem", color: "var(--color-success)" }}>
              ✓ key stored locally
            </span>
          )}
        </div>
        {!apiKey && (
          <p style={{ ...mono, fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }}>
            Your key is stored only in your browser and never sent to this server.
            Get yours at <span style={{ color: "var(--color-info)" }}>rest.fnar.net</span>.
          </p>
        )}

        {isFetching && (
          <div style={{ marginTop: "0.75rem" }}>
            <div style={{ ...mono, fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "0.25rem" }}>
              Loading player data from FIO… {fetchProgress!.done} / {fetchProgress!.total} ({fetchPct}%)
            </div>
            <div
              style={{
                height: 4,
                background: "var(--color-bg-elevated)",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${fetchPct}%`,
                  background: "var(--color-accent-primary)",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="terminal-box" style={{ marginBottom: "1.5rem", padding: "1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ ...mono, color: "var(--color-text-muted)" }}>Min bases</span>
          <input
            type="number"
            className="terminal-input"
            value={minBases}
            min={1}
            onChange={(e) => setMinBases(e.target.value)}
            style={{ width: "5rem" }}
          />
          <span style={{ ...mono, color: "var(--color-text-muted)", marginLeft: "0.5rem" }}>Search</span>
          <input
            type="text"
            className="terminal-input"
            value={search}
            placeholder="username / company / corp"
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "16rem" }}
          />
          <span style={{ ...mono, color: "var(--color-text-muted)", marginLeft: "auto" }}>
            {sorted.length} players
          </span>
        </div>
      </div>

      {error && (
        <div
          className="terminal-box"
          style={{ marginBottom: "1.5rem", padding: "1rem", color: "var(--color-error)", borderColor: "var(--color-error)" }}
        >
          Error: {error}
        </div>
      )}

      {loadingPublic ? (
        <div style={{ ...mono, color: "var(--color-text-muted)", padding: "2rem", textAlign: "center" }}>
          Loading…
        </div>
      ) : !apiKey ? (
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
                    {row.daysActive !== null
                      ? row.daysActive.toLocaleString()
                      : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {row.daysPerBase !== null ? (
                      <span
                        style={{
                          color: row.daysPerBase < 30
                            ? "var(--color-success)"
                            : row.daysPerBase < 60
                            ? "var(--color-warning)"
                            : "var(--color-text-secondary)",
                          fontWeight: row.daysPerBase < 30 ? 600 : undefined,
                        }}
                      >
                        {row.daysPerBase.toFixed(1)}
                      </span>
                    ) : (
                      <span style={{ color: "var(--color-text-muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "2rem" }}>
                    {isFetching ? "Loading player data…" : "No results."}
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

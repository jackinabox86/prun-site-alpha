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
  exchangeData: ExchangeTicker[];
  orders: CxosOrder[];
}

interface ExchangeTicker {
  MaterialTicker: string;
  ExchangeCode: string;
  Ask: number | null;
  Bid: number | null;
  [key: string]: unknown;
}

interface CxosOrder {
  MaterialTicker: string;
  ExchangeCode: string;
  OrderType: string;
  Status: string;
  Limit: number;
  Amount: number;
  [key: string]: unknown;
}

interface DeficitRow {
  ticker: string;
  demand: number;
  onHand: number;
  deficit: number;
}

interface ExchangeBid {
  exchange: string;
  marketBid: number | null;
  effectiveBid: number | null;
  perUnitSavings: number | null;
  netSavings: number | null;
  returnPct: number | null;
}

interface ResupplyRow {
  ticker: string;
  deficit: number;
  askAtSelected: number | null;
  bids: Record<string, ExchangeBid>;
  savingsAtSelected: number | null;
  returnAtSelected: number | null;
  bestSavings: number | null;
  bestReturnPct: number | null;
  bestExchange: string | null;
}

interface StaleBid {
  ticker: string;
  exchange: string;
  myLimit: number;
  marketBid: number;
  amount: number;
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatCurrency(value: number): string {
  // Whole numbers shown without decimals; otherwise show one decimal place
  const rounded = Math.round(value * 10) / 10;
  if (rounded === Math.trunc(rounded)) {
    return rounded.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
  return rounded.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Increment at 3rd significant figure: 10.1→10.2, 1020→1030, 99→100, 0.5→0.501 */
function incrementBid(n: number): number {
  if (n <= 0) return 0.01;
  const magnitude = Math.floor(Math.log10(n));
  const increment = Math.pow(10, magnitude - 2);
  const result = n + increment;
  // Round to avoid floating point artifacts
  const decimals = Math.max(0, 2 - magnitude);
  return parseFloat(result.toFixed(decimals));
}

const EXCHANGE_CODES = ["AI1", "NC1", "CI1", "IC1"];
const EXCHANGE_SHORT: Record<string, string> = {
  AI1: "ANT",
  NC1: "MOR",
  CI1: "BEN",
  IC1: "HRT",
};

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
  const [weeklyRate, setWeeklyRate] = usePersistedSettings<string>(
    "prun:resupply:weeklyRate",
    "3",
    { updateUrl: false }
  );
  const [ignoreTickers, setIgnoreTickers] = usePersistedSettings<string>(
    "prun:resupply:ignoreTickers",
    "",
    { updateUrl: false }
  );
  const [minSavings, setMinSavings] = usePersistedSettings<string>(
    "prun:resupply:minSavings",
    "0",
    { updateUrl: false }
  );

  const hasCredentials = fioUsername.trim() !== "" && fioApiKey.trim() !== "";
  const targetDaysNum = Math.max(1, parseInt(targetDays, 10) || 14);
  const weeklyRateNum = Math.max(0, parseFloat(weeklyRate) || 3);
  const minSavingsNum = Math.max(0, parseFloat(minSavings) || 0);
  const ignoreTickersNormalized = ignoreTickers.split(/[,\s]+/).map(t => t.trim().toUpperCase()).filter(Boolean).sort().join(",");

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

  // --- Phase 3 + 4: Price comparison, order integration, savings calculation ---
  const { resupplyRows, staleBids } = useMemo(() => {
    const empty = { resupplyRows: [] as ResupplyRow[], staleBids: [] as StaleBid[] };
    if (!rawData || deficitRows.length === 0) return empty;

    const ignoreSet = new Set(ignoreTickersNormalized ? ignoreTickersNormalized.split(",") : []);

    // Step 4: Build exchange price lookups
    const askMap = new Map<string, number>();
    const bidMap = new Map<string, number>();
    for (const entry of rawData.exchangeData) {
      const key = `${entry.MaterialTicker}.${entry.ExchangeCode}`;
      if (entry.Ask != null && entry.Ask > 0) askMap.set(key, entry.Ask);
      if (entry.Bid != null && entry.Bid > 0) bidMap.set(key, entry.Bid);
    }

    // Step 4b (Phase 4): Process user orders — classify top bids vs stale bids
    const staleBids: StaleBid[] = [];
    // topBidMap: "TICKER.EXCHANGE" → limit price (for effective bid calculation)
    const topBidMap = new Map<string, number>();
    // topBidDeductions: ticker → total amount covered by existing top bids
    const topBidDeductions = new Map<string, number>();

    for (const order of rawData.orders) {
      const orderType = (order.OrderType || "").toString().toUpperCase();
      const status = (order.Status || "").toString().toUpperCase();
      if (orderType !== "BUYING") continue;
      if (status !== "PLACED" && status !== "PARTIALLY_FILLED") continue;

      const key = `${order.MaterialTicker}.${order.ExchangeCode}`;
      const marketBid = bidMap.get(key);

      if (marketBid != null && order.Limit === marketBid) {
        // User has top bid at this exchange
        topBidMap.set(key, order.Limit);
        topBidDeductions.set(
          order.MaterialTicker,
          (topBidDeductions.get(order.MaterialTicker) || 0) + order.Amount
        );
      } else if (marketBid != null) {
        // Stale bid — limit doesn't match market
        staleBids.push({
          ticker: order.MaterialTicker,
          exchange: order.ExchangeCode,
          myLimit: order.Limit,
          marketBid,
          amount: order.Amount,
        });
      }
    }

    // Step 5: Compute resupply rows (with order-aware deficits and effective bids)
    const returnThreshold = Math.pow(1 + weeklyRateNum / 100, targetDaysNum / 7) - 1;

    const rows: ResupplyRow[] = [];
    for (const dr of deficitRows) {
      if (dr.deficit <= 0) continue;
      if (ignoreSet.has(dr.ticker)) continue;

      // Deduct top-bid amounts from deficit
      const deduction = topBidDeductions.get(dr.ticker) || 0;
      const adjustedDeficit = dr.deficit - deduction;
      if (adjustedDeficit <= 0) continue;

      const askKey = `${dr.ticker}.${selectedExchange}`;
      const askAtSelected = askMap.get(askKey) ?? null;

      const bids: Record<string, ExchangeBid> = {};
      let bestSavings: number | null = null;
      let bestReturnPct: number | null = null;
      let bestExchange: string | null = null;

      for (const ex of EXCHANGE_CODES) {
        const marketBid = bidMap.get(`${dr.ticker}.${ex}`) ?? null;
        let effectiveBid: number | null = null;
        let perUnitSavings: number | null = null;
        let netSavings: number | null = null;
        let returnPct: number | null = null;

        if (marketBid != null) {
          // If user has top bid at this exchange, use their limit price
          const userTopBid = topBidMap.get(`${dr.ticker}.${ex}`);
          effectiveBid = userTopBid != null ? userTopBid : incrementBid(marketBid);

          if (askAtSelected != null) {
            perUnitSavings = askAtSelected - effectiveBid;
            returnPct = effectiveBid > 0 ? perUnitSavings / effectiveBid : null;
            netSavings = perUnitSavings * adjustedDeficit;

            if (netSavings != null && (bestSavings === null || netSavings > bestSavings)) {
              bestSavings = netSavings;
              bestReturnPct = returnPct;
              bestExchange = ex;
            }
          }
        }

        bids[ex] = { exchange: ex, marketBid, effectiveBid, perUnitSavings, netSavings, returnPct };
      }

      const selectedBid = bids[selectedExchange];
      const returnAtSelected = selectedBid?.returnPct ?? null;
      const savingsAtSelected = selectedBid?.netSavings ?? null;

      // Filter: include if return at selected OR best exchange >= threshold
      const meetsThreshold =
        (returnAtSelected !== null && returnAtSelected >= returnThreshold) ||
        (bestReturnPct !== null && bestReturnPct >= returnThreshold);

      if (!meetsThreshold) continue;

      rows.push({
        ticker: dr.ticker,
        deficit: adjustedDeficit,
        askAtSelected,
        bids,
        savingsAtSelected,
        returnAtSelected,
        bestSavings,
        bestReturnPct,
        bestExchange,
      });
    }

    // Sort by best net savings descending
    rows.sort((a, b) => (b.bestSavings ?? -Infinity) - (a.bestSavings ?? -Infinity));

    return { resupplyRows: rows, staleBids };
  }, [rawData, deficitRows, selectedExchange, targetDaysNum, weeklyRateNum, ignoreTickersNormalized]);

  // Apply min savings filter
  const filteredRows = useMemo(() => {
    if (minSavingsNum <= 0) return resupplyRows;
    return resupplyRows.filter(r => (r.bestSavings ?? 0) >= minSavingsNum);
  }, [resupplyRows, minSavingsNum]);

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
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
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
                Weekly Return %
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={weeklyRate}
                onChange={(e) => setWeeklyRate(e.target.value)}
                className="terminal-input"
                style={{ width: "80px", textAlign: "center" }}
              />
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
                Ignore Tickers
              </label>
              <input
                type="text"
                placeholder="e.g. DW, RAT"
                value={ignoreTickers}
                onChange={(e) => setIgnoreTickers(e.target.value)}
                className="terminal-input"
                style={{ width: "160px" }}
              />
            </div>
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

      {/* Summary Stats */}
      {rawData && parsedCount > 0 && (
        <div
          className="terminal-box"
          style={{
            marginBottom: "2rem",
            display: "flex",
            gap: "2rem",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.7rem",
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                marginBottom: "0.25rem",
              }}
            >
              Deficit Tickers
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "1.25rem",
                color: "var(--color-text-primary)",
              }}
            >
              {deficitRows.filter(r => r.deficit > 0).length}
            </div>
          </div>
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.7rem",
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                marginBottom: "0.25rem",
              }}
            >
              Bid Opportunities
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "1.25rem",
                color: "var(--color-text-primary)",
              }}
            >
              {resupplyRows.length}
            </div>
          </div>
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.7rem",
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                marginBottom: "0.25rem",
              }}
            >
              Total Potential Savings
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "1.25rem",
                color: "var(--color-accent-primary)",
              }}
            >
              {formatCurrency(
                resupplyRows.reduce((sum, r) => sum + (r.savingsAtSelected ?? 0), 0)
              )}
            </div>
          </div>
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.7rem",
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                marginBottom: "0.25rem",
              }}
            >
              Stale Bids
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "1.25rem",
                color:
                  staleBids.length > 0
                    ? "var(--color-error, #ff4444)"
                    : "var(--color-success, #44ff44)",
              }}
            >
              {staleBids.length}
            </div>
          </div>
        </div>
      )}

      {/* Deficit Table — shown when burn data parsed but no API data yet */}
      {deficitRows.length > 0 && !rawData && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div className="terminal-header" style={{ marginBottom: "1rem" }}>
            Supply Deficits — {targetDaysNum} day target ({deficitRows.filter(r => r.deficit > 0).length} need resupply)
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              color: "var(--color-text-muted)",
              marginBottom: "1rem",
            }}
          >
            Fetch data to see price comparisons and savings across exchanges.
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

      {/* Resupply Results Table */}
      {rawData && parsedCount > 0 && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "1rem",
              marginBottom: "1rem",
            }}
          >
            <div className="terminal-header" style={{ margin: 0 }}>
              Resupply Opportunities — {EXCHANGE_LOCATION[selectedExchange]} ({filteredRows.length} of {resupplyRows.length})
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <label
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.7rem",
                  color: "var(--color-text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Min Savings
              </label>
              <input
                type="number"
                min="0"
                value={minSavings}
                onChange={(e) => setMinSavings(e.target.value)}
                className="terminal-input"
                style={{ width: "80px", textAlign: "center" }}
              />
            </div>
          </div>
          {filteredRows.length === 0 ? (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.8rem",
                color: "var(--color-text-muted)",
                textAlign: "center",
                padding: "2rem 1rem",
              }}
            >
              No tickers meet the {weeklyRateNum}% weekly return threshold
              {minSavingsNum > 0 ? ` and ${formatCurrency(minSavingsNum)} min savings filter` : ""}.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.8rem",
                }}
              >
                <thead>
                  <tr>
                    {[
                      { label: "Ticker", align: "left" },
                      { label: "Deficit", align: "right" },
                      { label: `Ask (${EXCHANGE_SHORT[selectedExchange]})`, align: "right" },
                      ...EXCHANGE_CODES.map(ex => ({ label: `Bid (${EXCHANGE_SHORT[ex]})`, align: "right" as const })),
                      { label: "Savings @ Selected", align: "right" },
                      { label: "Best Savings", align: "right" },
                    ].map((col) => (
                      <th
                        key={col.label}
                        style={{
                          padding: "0.5rem 0.6rem",
                          borderBottom: "1px solid var(--color-border-primary)",
                          fontSize: "0.7rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: "var(--color-text-secondary)",
                          textAlign: col.align as "left" | "right",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={row.ticker}
                      style={{
                        borderBottom: "1px solid var(--color-border-secondary, rgba(255,255,255,0.05))",
                      }}
                    >
                      <td
                        style={{
                          padding: "0.5rem 0.6rem",
                          color: "var(--color-accent-primary)",
                          fontWeight: "bold",
                        }}
                      >
                        {row.ticker}
                      </td>
                      <td style={{ padding: "0.5rem 0.6rem", textAlign: "right" }}>
                        {formatNumber(row.deficit)}
                      </td>
                      <td style={{ padding: "0.5rem 0.6rem", textAlign: "right" }}>
                        {row.askAtSelected != null ? formatCurrency(row.askAtSelected) : "—"}
                      </td>
                      {EXCHANGE_CODES.map((ex) => {
                        const bid = row.bids[ex];
                        const isSelected = ex === selectedExchange;
                        return (
                          <td
                            key={ex}
                            style={{
                              padding: "0.5rem 0.6rem",
                              textAlign: "right",
                              fontWeight: isSelected ? "bold" : "normal",
                              color: isSelected
                                ? "var(--color-accent-primary)"
                                : "var(--color-text-secondary)",
                            }}
                          >
                            {bid?.marketBid != null ? formatCurrency(bid.marketBid) : "—"}
                          </td>
                        );
                      })}
                      <td
                        style={{
                          padding: "0.5rem 0.6rem",
                          textAlign: "right",
                          color: (row.savingsAtSelected ?? 0) > 0
                            ? "var(--color-accent-primary)"
                            : "var(--color-text-muted)",
                        }}
                      >
                        {row.savingsAtSelected != null ? (
                          <>
                            {formatCurrency(row.savingsAtSelected)}
                            {row.returnAtSelected != null && (
                              <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginLeft: "0.3rem" }}>
                                ({(row.returnAtSelected * 100).toFixed(1)}%)
                              </span>
                            )}
                          </>
                        ) : "—"}
                      </td>
                      <td
                        style={{
                          padding: "0.5rem 0.6rem",
                          textAlign: "right",
                          color: (row.bestSavings ?? 0) > 0
                            ? "var(--color-accent-primary)"
                            : "var(--color-text-muted)",
                        }}
                      >
                        {row.bestSavings != null ? (
                          <>
                            {formatCurrency(row.bestSavings)}
                            {row.bestReturnPct != null && (
                              <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginLeft: "0.3rem" }}>
                                ({(row.bestReturnPct * 100).toFixed(1)}%)
                              </span>
                            )}
                            {row.bestExchange && (
                              <span style={{ fontSize: "0.65rem", color: "var(--color-text-muted)", marginLeft: "0.3rem" }}>
                                {EXCHANGE_SHORT[row.bestExchange]}
                              </span>
                            )}
                          </>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Stale Bids Warning */}
      {staleBids.length > 0 && (
        <div
          className="terminal-box"
          style={{
            marginBottom: "2rem",
            borderColor: "var(--color-error, #ff4444)",
          }}
        >
          <div
            className="terminal-header"
            style={{
              marginBottom: "1rem",
              color: "var(--color-error, #ff4444)",
            }}
          >
            Stale Bids — {staleBids.length} orders need attention
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
              marginBottom: "1rem",
            }}
          >
            These buy orders no longer match the market bid. Consider updating or removing them in-game.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontFamily: "var(--font-mono)",
                fontSize: "0.8rem",
              }}
            >
              <thead>
                <tr>
                  {[
                    { label: "Ticker", align: "left" },
                    { label: "Exchange", align: "left" },
                    { label: "My Limit", align: "right" },
                    { label: "Market Bid", align: "right" },
                    { label: "Amount", align: "right" },
                  ].map((col) => (
                    <th
                      key={col.label}
                      style={{
                        padding: "0.5rem 0.75rem",
                        borderBottom: "1px solid var(--color-border-primary)",
                        fontSize: "0.7rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--color-text-secondary)",
                        textAlign: col.align as "left" | "right",
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staleBids.map((sb, i) => (
                  <tr
                    key={`${sb.ticker}-${sb.exchange}-${i}`}
                    style={{
                      borderBottom: "1px solid var(--color-border-secondary, rgba(255,255,255,0.05))",
                    }}
                  >
                    <td
                      style={{
                        padding: "0.5rem 0.75rem",
                        color: "var(--color-accent-primary)",
                        fontWeight: "bold",
                      }}
                    >
                      {sb.ticker}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      {EXCHANGE_SHORT[sb.exchange] || sb.exchange}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>
                      {formatCurrency(sb.myLimit)}
                    </td>
                    <td
                      style={{
                        padding: "0.5rem 0.75rem",
                        textAlign: "right",
                        color: "var(--color-accent-primary)",
                      }}
                    >
                      {formatCurrency(sb.marketBid)}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>
                      {formatNumber(sb.amount)}
                    </td>
                  </tr>
                ))}
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

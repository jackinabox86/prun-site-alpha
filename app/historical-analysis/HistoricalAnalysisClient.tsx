"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface ExchangeStats {
  exchange: string;
  avgTradedCount: number;
  recordCount: number;
  avgPrice: number;
  totalVolume: number;
  totalTraded: number;
}

interface AnalysisResult {
  days: number;
  cutoffDate: string;
  exchangeStats: ExchangeStats[];
  universeTotal: {
    avgTradedCount: number;
    recordCount: number;
    avgPrice: number;
    totalVolume: number;
    totalTraded: number;
  };
  tickerCount: number;
  filesProcessed: number;
  lastUpdated: number;
  ticker?: string;
  error?: string;
  hint?: string;
}

// All available tickers
const TICKERS = [
  "GWS", "NV2", "CRU", "SST", "TAC", "CC", "STS", "PFG", "BOS", "BE", "TA", "ZR", "W", "SDM", "WR",
  "LOG", "COM", "RCS", "ADS", "WS", "AIR", "ACS", "LIS", "NV1", "PDA", "FFC", "AST", "FET", "WAL",
  "CTF", "FAL", "WRH", "ALR", "OVE", "EXO", "PE", "PWO", "REP", "MG", "SEA", "PT", "SUN", "OFF",
  "I", "MCG", "STR", "PFE", "SOI", "FLX", "CA", "IND", "NAB", "LCR", "REA", "SC", "NS", "CL",
  "MED", "OLF", "SPT", "HMS", "LC", "HSS", "NFI", "TRN", "TRA", "NCS", "LDI", "SWF", "CAP", "SFE",
  "MTC", "MWF", "MFE", "CCD", "DCH", "SUD", "RED", "SRD", "SDR", "DRF", "CBL", "POW", "VOR", "SOL",
  "FIR", "RAG", "CBS", "SP", "CBM", "SCN", "HOG", "RAD", "MHP", "BID", "KRE", "EES", "ES", "SAR",
  "CD", "AAR", "AWF", "BWS", "HPC", "BMF", "LFE", "VIT", "WIN", "GIN", "ALE", "KOM", "DW", "PPA",
  "COF", "RAT", "MEA", "FIM", "FOD", "NUT", "BEA", "GRN", "RCO", "HCP", "VEG", "HER", "MAI", "FLO",
  "BRO", "BGC", "BCO", "SFK", "HCC", "BFR", "MFK", "AFR", "UTS", "SEQ", "RGO", "BGO", "NG", "RG",
  "TUB", "LIT", "GCH", "GNZ", "GL", "GEN", "LHP", "BHP", "HHP", "RHP", "ATP", "BWH", "AWH", "AHP",
  "ALG", "MUS", "CAF", "C", "RSI", "MTP", "VG", "JUI", "BLE", "DDT", "TCL", "NST", "BL", "BAC",
  "CST", "THF", "NR", "FAN", "DIS", "HD", "MB", "PIB", "GRA", "HOP", "EBU", "CBU", "PBU", "SBU",
  "TBU", "ADR", "BSC", "BND", "PK", "DEC", "EPO", "PG", "BDE", "BSE", "BTA", "BBH", "LSE", "LTA",
  "LBH", "LDE", "AEF", "INS", "RBH", "RDE", "RTA", "MGC", "PSH", "RSE", "HSE", "TSH", "ASE", "ATA",
  "RSH", "ADE", "ABH", "TRS", "PSS", "LFP", "PSM", "DCL", "DCM", "PSL", "DCS", "SF", "FF", "VF",
  "HE3", "ROM", "MPC", "PCB", "SEN", "TPU", "RAM", "BAI", "LD", "MLI", "NF", "SA", "SAL", "WM",
  "NN", "OS", "DD", "DA", "DV", "EDC", "WCB", "MCB", "MFL", "LSL", "LCB", "VCB", "TCB", "SSL",
  "LFL", "VSC", "SCB", "MSL", "VFT", "SFL", "HCB", "IMM", "WAI", "SNM", "IDC", "LI", "AU", "S",
  "STL", "SI", "CF", "TI", "CU", "AL", "FE", "RE", "NOZ", "HPR", "RCT", "QCR", "AFP", "BFP", "VOE",
  "ANZ", "HNZ", "HYR", "AEN", "ENG", "FSE", "HTE", "AGS", "APT", "BRP", "ARP", "SRP", "BPT", "BGS",
  "ETC", "TC", "TCS", "CPU", "BR1", "BR2", "CQM", "BRS", "DOU", "TCU", "HAM", "FUN", "BSU", "LU",
  "CQL", "RDS", "WOR", "CQT", "RDL", "SU", "CQS", "HAB", "CHA", "FC", "GV", "GC", "FLP", "MHL",
  "TOR", "SSC", "TRU", "THP", "TK", "COT", "SIL", "NL", "KV"
];

export default function HistoricalAnalysisClient() {
  const [days, setDays] = useState<string>("90");
  const [ticker, setTicker] = useState<string>("RAT");
  const [showAutocomplete, setShowAutocomplete] = useState<boolean>(false);
  const [filteredTickers, setFilteredTickers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);

  // Filter tickers based on input
  useEffect(() => {
    if (ticker.trim() === "") {
      setFilteredTickers([]);
      return;
    }
    const filtered = TICKERS.filter(t =>
      t.toLowerCase().startsWith(ticker.toLowerCase())
    ).slice(0, 10);
    setFilteredTickers(filtered);
  }, [ticker]);

  // Close autocomplete when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (autocompleteRef.current && !autocompleteRef.current.contains(event.target as Node)) {
        setShowAutocomplete(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadData = useCallback(async (analyzeUniverse: boolean = false) => {
    setLoading(true);
    setError(null);
    try {
      const daysNum = parseInt(days, 10);
      if (isNaN(daysNum) || daysNum <= 0) {
        setError("Please enter a valid number of days");
        setLoading(false);
        return;
      }

      if (!analyzeUniverse && !ticker.trim()) {
        setError("Please enter a ticker");
        setLoading(false);
        return;
      }

      const params: any = { days: days };
      if (!analyzeUniverse) {
        params.ticker = ticker.toUpperCase();
      }

      const qs = new URLSearchParams(params);
      const res = await fetch(`/api/historical-analysis?${qs.toString()}`, {
        cache: "no-store",
      });

      const json: AnalysisResult = await res.json();

      if (json.error) {
        setError(json.error);
        if (json.hint) {
          setError(`${json.error}\n\nHint: ${json.hint}`);
        }
        setData(null);
        return;
      }

      setData(json);
    } catch (err: any) {
      setError(err.message || "Failed to load analysis data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days, ticker]);

  const handleTickerSelect = (selectedTicker: string) => {
    setTicker(selectedTicker);
    setShowAutocomplete(false);
  };

  const formatNumber = (value: number): string => {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatInteger = (value: number): string => {
    return Math.floor(value).toLocaleString();
  };

  return (
    <div className="terminal-container">
      {/* Header */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <h1 className="terminal-header" style={{ margin: 0 }}>
          HISTORICAL TRADING DATA ANALYSIS
        </h1>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "0.875rem", margin: 0 }}>
          Analyze trading activity for individual tickers or across the entire universe
        </p>
      </div>

      {/* Controls */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <h2 className="terminal-header">ANALYSIS CONTROLS</h2>

        <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          {/* Ticker Input with Autocomplete */}
          <div style={{ position: "relative", flex: "0 0 auto" }} ref={autocompleteRef}>
            <label
              htmlFor="ticker-input"
              style={{
                display: "block",
                color: "var(--color-text-secondary)",
                marginBottom: "0.5rem",
                fontSize: "0.875rem",
                textTransform: "uppercase",
                letterSpacing: "0.05em"
              }}
            >
              Ticker
            </label>
            <input
              id="ticker-input"
              type="text"
              value={ticker}
              onChange={(e) => {
                setTicker(e.target.value.toUpperCase());
                setShowAutocomplete(true);
              }}
              onFocus={() => setShowAutocomplete(true)}
              placeholder="Enter ticker"
              className="terminal-input"
              style={{
                width: "180px",
                textTransform: "uppercase",
              }}
            />
            {/* Autocomplete Dropdown */}
            {showAutocomplete && filteredTickers.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  backgroundColor: "var(--color-bg-elevated)",
                  border: "1px solid var(--color-border-primary)",
                  maxHeight: "200px",
                  overflowY: "auto",
                  zIndex: 1000,
                  marginTop: "0.25rem",
                }}
              >
                {filteredTickers.map((t) => (
                  <div
                    key={t}
                    onClick={() => handleTickerSelect(t)}
                    style={{
                      padding: "0.5rem 0.75rem",
                      cursor: "pointer",
                      color: "var(--color-text-primary)",
                      borderBottom: "1px solid var(--color-border-secondary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.875rem",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)";
                      e.currentTarget.style.color = "var(--color-accent-primary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.color = "var(--color-text-primary)";
                    }}
                  >
                    {t}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Days Input */}
          <div style={{ flex: "0 0 auto" }}>
            <label
              htmlFor="days-input"
              style={{
                display: "block",
                color: "var(--color-text-secondary)",
                marginBottom: "0.5rem",
                fontSize: "0.875rem",
                textTransform: "uppercase",
                letterSpacing: "0.05em"
              }}
            >
              Days
            </label>
            <input
              id="days-input"
              type="number"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              min="1"
              max="365"
              className="terminal-input"
              style={{ width: "120px" }}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: "0.75rem", flex: "0 0 auto" }}>
            <button
              onClick={() => loadData(false)}
              disabled={loading}
              className="terminal-button"
            >
              {loading ? "Loading..." : "Analyze Ticker"}
            </button>
            <button
              onClick={() => loadData(true)}
              disabled={loading}
              className="terminal-button"
              style={{
                backgroundColor: "var(--color-success)",
                color: "var(--color-bg-primary)",
                borderColor: "var(--color-success)",
              }}
            >
              {loading ? "Loading..." : "Analyze Universe"}
            </button>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="terminal-box" style={{
          marginBottom: "2rem",
          backgroundColor: "var(--color-bg-tertiary)",
          borderColor: "var(--color-error)",
        }}>
          <div style={{
            color: "var(--color-error)",
            whiteSpace: "pre-wrap",
            fontFamily: "var(--font-mono)",
            fontSize: "0.875rem",
          }}>
            {error}
          </div>
        </div>
      )}

      {/* Results Display */}
      {data && (
        <>
          {/* Summary Info */}
          <div className="terminal-box" style={{ marginBottom: "2rem" }}>
            <h2 className="terminal-header">
              ANALYSIS SUMMARY {data.ticker && `// ${data.ticker}`}
            </h2>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "1.5rem"
            }}>
              <div>
                <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Period</div>
                <div style={{ color: "var(--color-text-primary)", fontSize: "1rem", fontWeight: "600", fontFamily: "var(--font-mono)" }}>
                  Last {data.days} days
                </div>
                <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", marginTop: "0.25rem" }}>
                  Since {new Date(data.cutoffDate).toLocaleDateString()}
                </div>
              </div>
              {data.ticker && (
                <div>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Ticker</div>
                  <div style={{ color: "var(--color-accent-primary)", fontSize: "1rem", fontWeight: "600", fontFamily: "var(--font-mono)" }}>
                    {data.ticker}
                  </div>
                </div>
              )}
              {!data.ticker && (
                <div>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Tickers Processed</div>
                  <div style={{ color: "var(--color-text-primary)", fontSize: "1rem", fontWeight: "600", fontFamily: "var(--font-mono)" }}>
                    {data.tickerCount}
                  </div>
                </div>
              )}
              <div>
                <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Files Processed</div>
                <div style={{ color: "var(--color-text-primary)", fontSize: "1rem", fontWeight: "600", fontFamily: "var(--font-mono)" }}>
                  {data.filesProcessed}
                </div>
              </div>
              <div>
                <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Last Updated</div>
                <div style={{ color: "var(--color-text-primary)", fontSize: "1rem", fontWeight: "600", fontFamily: "var(--font-mono)" }}>
                  {new Date(data.lastUpdated).toLocaleTimeString()}
                </div>
              </div>
            </div>
          </div>

          {/* Exchange Stats Table */}
          <div className="terminal-box" style={{ marginBottom: "2rem" }}>
            <h2 className="terminal-header">EXCHANGE STATISTICS</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th>Exchange</th>
                    <th style={{ textAlign: "right" }}>Avg Traded/Day</th>
                    <th style={{ textAlign: "right" }}>Records</th>
                    <th style={{ textAlign: "right" }}>Avg Price</th>
                    <th style={{ textAlign: "right" }}>Total Volume</th>
                    <th style={{ textAlign: "right" }}>Total Traded</th>
                  </tr>
                </thead>
                <tbody>
                  {data.exchangeStats.map((exchange) => (
                    <tr key={exchange.exchange}>
                      <td style={{ fontWeight: "600", color: "var(--color-accent-primary)" }}>
                        {exchange.exchange}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {formatNumber(exchange.avgTradedCount)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {formatInteger(exchange.recordCount)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {formatNumber(exchange.avgPrice)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {formatInteger(exchange.totalVolume)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {formatInteger(exchange.totalTraded)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Total Section */}
          <div className="terminal-box" style={{ marginBottom: "2rem" }}>
            <h2 className="terminal-header">
              {data.ticker ? `${data.ticker} TOTAL` : "UNIVERSE TOTAL"}
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th style={{ textAlign: "right" }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ fontWeight: "600" }}>Average Traded Count (per day)</td>
                    <td style={{ textAlign: "right" }}>{formatNumber(data.universeTotal.avgTradedCount)}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: "600" }}>Total Records</td>
                    <td style={{ textAlign: "right" }}>{formatInteger(data.universeTotal.recordCount)}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: "600" }}>Average Price</td>
                    <td style={{ textAlign: "right" }}>{formatNumber(data.universeTotal.avgPrice)}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: "600" }}>Total Volume</td>
                    <td style={{ textAlign: "right" }}>{formatInteger(data.universeTotal.totalVolume)}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: "600" }}>Total Traded</td>
                    <td style={{ textAlign: "right" }}>{formatInteger(data.universeTotal.totalTraded)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Info Note */}
          <div className="terminal-box" style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-success)",
          }}>
            <div style={{
              color: "var(--color-text-secondary)",
              fontSize: "0.875rem",
              lineHeight: "1.6"
            }}>
              <strong style={{ color: "var(--color-success)" }}>Note:</strong> Average Traded Count is the average number of units traded per day
              over the selected period (Total Traded ÷ Days). Average Price is calculated as Total
              Volume divided by Total Traded. Record Count represents the number of daily data points
              available for each exchange (may be less than the period due to missing days).
            </div>
          </div>
        </>
      )}
    </div>
  );
}

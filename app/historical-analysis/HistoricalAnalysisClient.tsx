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
    <div style={{ padding: "20px", maxWidth: "1400px", margin: "0 auto" }}>
      <h1 style={{ color: "#ff8c00", marginBottom: "10px" }}>
        Historical Trading Data Analysis
      </h1>
      <p style={{ color: "#888", marginBottom: "20px", fontSize: "14px" }}>
        Analyze trading activity for individual tickers or across the entire universe
      </p>

      {/* Input Section */}
      <div style={{ marginBottom: "30px" }}>
        <div style={{ display: "flex", gap: "15px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "15px" }}>
          {/* Ticker Input with Autocomplete */}
          <div style={{ position: "relative" }} ref={autocompleteRef}>
            <label
              htmlFor="ticker-input"
              style={{ display: "block", color: "#ccc", marginBottom: "5px", fontSize: "14px" }}
            >
              Ticker:
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
              placeholder="Enter ticker (e.g., RAT)"
              style={{
                padding: "8px 12px",
                fontSize: "14px",
                backgroundColor: "#1a1a1a",
                color: "#ccc",
                border: "1px solid #444",
                borderRadius: "4px",
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
                  backgroundColor: "#1a1a1a",
                  border: "1px solid #444",
                  borderTop: "none",
                  borderRadius: "0 0 4px 4px",
                  maxHeight: "200px",
                  overflowY: "auto",
                  zIndex: 1000,
                  marginTop: "-1px",
                }}
              >
                {filteredTickers.map((t) => (
                  <div
                    key={t}
                    onClick={() => handleTickerSelect(t)}
                    style={{
                      padding: "8px 12px",
                      cursor: "pointer",
                      color: "#ccc",
                      borderBottom: "1px solid #333",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "#2a2a2a";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    {t}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Days Input */}
          <div>
            <label
              htmlFor="days-input"
              style={{ display: "block", color: "#ccc", marginBottom: "5px", fontSize: "14px" }}
            >
              Number of Days:
            </label>
            <input
              id="days-input"
              type="number"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              min="1"
              max="365"
              style={{
                padding: "8px 12px",
                fontSize: "14px",
                backgroundColor: "#1a1a1a",
                color: "#ccc",
                border: "1px solid #444",
                borderRadius: "4px",
                width: "120px",
              }}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => loadData(false)}
              disabled={loading}
              style={{
                padding: "8px 20px",
                fontSize: "14px",
                backgroundColor: "#ff8c00",
                color: "#000",
                border: "none",
                borderRadius: "4px",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                fontWeight: "bold",
              }}
            >
              {loading ? "Loading..." : "Analyze Ticker"}
            </button>
            <button
              onClick={() => loadData(true)}
              disabled={loading}
              style={{
                padding: "8px 20px",
                fontSize: "14px",
                backgroundColor: "#4a7c4a",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                fontWeight: "bold",
              }}
            >
              {loading ? "Loading..." : "Analyze Universe"}
            </button>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: "15px",
            marginBottom: "20px",
            backgroundColor: "#2a1a1a",
            border: "1px solid #ff4444",
            borderRadius: "4px",
            color: "#ff4444",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      {/* Results Display */}
      {data && (
        <>
          {/* Summary Info */}
          <div
            style={{
              padding: "15px",
              marginBottom: "30px",
              backgroundColor: "#1a1a1a",
              border: "1px solid #444",
              borderRadius: "4px",
            }}
          >
            <h2 style={{ color: "#ff8c00", marginBottom: "15px", fontSize: "18px" }}>
              Analysis Summary {data.ticker && `- ${data.ticker}`}
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "15px" }}>
              <div>
                <div style={{ color: "#888", fontSize: "12px" }}>Period</div>
                <div style={{ color: "#ccc", fontSize: "16px", fontWeight: "bold" }}>
                  Last {data.days} days
                </div>
                <div style={{ color: "#666", fontSize: "11px" }}>
                  Since {new Date(data.cutoffDate).toLocaleDateString()}
                </div>
              </div>
              {data.ticker && (
                <div>
                  <div style={{ color: "#888", fontSize: "12px" }}>Ticker</div>
                  <div style={{ color: "#ff8c00", fontSize: "16px", fontWeight: "bold" }}>
                    {data.ticker}
                  </div>
                </div>
              )}
              {!data.ticker && (
                <div>
                  <div style={{ color: "#888", fontSize: "12px" }}>Tickers Processed</div>
                  <div style={{ color: "#ccc", fontSize: "16px", fontWeight: "bold" }}>
                    {data.tickerCount}
                  </div>
                </div>
              )}
              <div>
                <div style={{ color: "#888", fontSize: "12px" }}>Files Processed</div>
                <div style={{ color: "#ccc", fontSize: "16px", fontWeight: "bold" }}>
                  {data.filesProcessed}
                </div>
              </div>
              <div>
                <div style={{ color: "#888", fontSize: "12px" }}>Last Updated</div>
                <div style={{ color: "#ccc", fontSize: "16px", fontWeight: "bold" }}>
                  {new Date(data.lastUpdated).toLocaleTimeString()}
                </div>
              </div>
            </div>
          </div>

          {/* Exchange Stats Table */}
          <div style={{ marginBottom: "30px" }}>
            <h2 style={{ color: "#ff8c00", marginBottom: "15px", fontSize: "18px" }}>
              Exchange Statistics
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  backgroundColor: "#1a1a1a",
                  color: "#ccc",
                  borderCollapse: "collapse",
                  fontSize: "14px",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "2px solid #ff8c00" }}>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "left",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Exchange
                    </th>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Avg Traded Count
                    </th>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Record Count
                    </th>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Avg Price
                    </th>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Total Volume
                    </th>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Total Traded
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.exchangeStats.map((exchange, idx) => (
                    <tr
                      key={exchange.exchange}
                      style={{
                        borderBottom: "1px solid #333",
                        backgroundColor: idx % 2 === 0 ? "#1a1a1a" : "#222",
                      }}
                    >
                      <td
                        style={{
                          padding: "12px",
                          fontWeight: "bold",
                          color: "#ff8c00",
                        }}
                      >
                        {exchange.exchange}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        {formatNumber(exchange.avgTradedCount)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        {formatInteger(exchange.recordCount)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        {formatNumber(exchange.avgPrice)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        {formatInteger(exchange.totalVolume)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        {formatInteger(exchange.totalTraded)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Total Section - Label changes based on mode */}
          <div style={{ marginBottom: "30px" }}>
            <h2 style={{ color: "#ff8c00", marginBottom: "15px", fontSize: "18px" }}>
              {data.ticker ? `${data.ticker} Total` : "Universe Total"}
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  backgroundColor: "#1a1a1a",
                  color: "#ccc",
                  borderCollapse: "collapse",
                  fontSize: "14px",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "2px solid #ff8c00" }}>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "left",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Metric
                    </th>
                    <th
                      style={{
                        padding: "12px",
                        textAlign: "right",
                        color: "#ff8c00",
                        fontWeight: "bold",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid #333", backgroundColor: "#1a1a1a" }}>
                    <td style={{ padding: "12px", fontWeight: "bold" }}>
                      Average Traded Count
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {formatNumber(data.universeTotal.avgTradedCount)}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #333", backgroundColor: "#222" }}>
                    <td style={{ padding: "12px", fontWeight: "bold" }}>
                      Total Records
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {formatInteger(data.universeTotal.recordCount)}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #333", backgroundColor: "#1a1a1a" }}>
                    <td style={{ padding: "12px", fontWeight: "bold" }}>
                      Average Price
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {formatNumber(data.universeTotal.avgPrice)}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #333", backgroundColor: "#222" }}>
                    <td style={{ padding: "12px", fontWeight: "bold" }}>
                      Total Volume
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {formatInteger(data.universeTotal.totalVolume)}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #333", backgroundColor: "#1a1a1a" }}>
                    <td style={{ padding: "12px", fontWeight: "bold" }}>
                      Total Traded
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {formatInteger(data.universeTotal.totalTraded)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Info Note */}
          <div
            style={{
              padding: "15px",
              backgroundColor: "#1a2a1a",
              border: "1px solid #4a7c4a",
              borderRadius: "4px",
              color: "#8ac98a",
              fontSize: "13px",
            }}
          >
            <strong>Note:</strong> Average Traded Count is the average number of units traded per
            record. Average Price is calculated as Total Volume divided by Total Traded. Record
            Count represents the number of daily data points available for each exchange over the
            selected period.
          </div>
        </>
      )}
    </div>
  );
}

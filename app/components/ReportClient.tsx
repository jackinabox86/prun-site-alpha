"use client";

import { useEffect, useMemo, useState } from "react";
import type { PriceMode, Exchange, PriceType } from "@/types";
import BestScenarioSankey from "./BestScenarioSankey";
import Top20Table from "./Top20Table";
import CondensedOptionsTable from "./CondensedOptionsTable";
import { scenarioDisplayName } from "@/core/scenario";
import { formatCurrency, formatCurrencyRounded, getCurrencySymbol } from "@/lib/formatting";

type ApiReport = {
  schemaVersion: number;
  ok?: boolean;
  error?: string;
  ticker: string;
  exchange: Exchange;
  priceType: PriceType;
  totalOptions: number;
  bestPA: number | null;
  best: any;
  top20: any[];
  topDisplayScenarios: any[];
};

export default function ReportClient() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [tickerInput, setTickerInput] = useState<string>("CBS");
  const [exchange, setExchange] = useState<Exchange>("ANT");
  const [priceType, setPriceType] = useState<PriceType>("bid");
  const [priceSource, setPriceSource] = useState<"local" | "gcs">("gcs");
  const [urlParamsChecked, setUrlParamsChecked] = useState(false);
  const [forceMake, setForceMake] = useState<string>("");
  const [forceBuy, setForceBuy] = useState<string>("");
  const [forceRecipe, setForceRecipe] = useState<string>("");
  const [excludeRecipe, setExcludeRecipe] = useState<string>("");
  const [showRecipeList, setShowRecipeList] = useState(false);
  const [showExtractionPlanets, setShowExtractionPlanets] = useState(false);
  const [analysisCollapsed, setAnalysisCollapsed] = useState(false);
  const [systemControlsCollapsed, setSystemControlsCollapsed] = useState(true);
  const [showTickerDropdown, setShowTickerDropdown] = useState(false);
  const [extractionMode, setExtractionMode] = useState(false);

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ApiReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readmeHidden, setReadmeHidden] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (extractionMode) {
      params.set("extractionMode", "true");
    }
    const url = params.toString() ? `/api/tickers?${params}` : "/api/tickers";

    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load tickers"))))
      .then((data: { tickers: string[] }) => setTickers(data.tickers ?? []))
      .catch(() => setTickers([]));
  }, [extractionMode]);

  // Read ticker from URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tickerParam = params.get("ticker");
    if (tickerParam) {
      setTickerInput(tickerParam.toUpperCase());
    }
    setUrlParamsChecked(true);
  }, []);

  // Close extraction planets dropdown when exchange changes
  useEffect(() => {
    setShowExtractionPlanets(false);
  }, [exchange]);

  const filteredTickers = useMemo(() => {
    if (!tickerInput) return tickers.slice(0, 50);
    const q = tickerInput.toUpperCase();
    return tickers.filter((t) => t.toUpperCase().startsWith(q)).slice(0, 50);
  }, [tickers, tickerInput]);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {
        ticker: tickerInput.trim().toUpperCase(),
        exchange,
        priceType,
        priceSource,
        extractionMode: extractionMode ? "true" : "false",
      };

      // Only include forceMake and forceBuy if they're not empty
      if (forceMake.trim()) {
        params.forceMake = forceMake.trim();
      }
      if (forceBuy.trim()) {
        params.forceBuy = forceBuy.trim();
      }
      if (forceRecipe.trim()) {
        params.forceRecipe = forceRecipe.trim();
      }
      if (excludeRecipe.trim()) {
        params.excludeRecipe = excludeRecipe.trim();
      }

      const qs = new URLSearchParams(params);
      const res = await fetch(`/api/report?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `${res.status} ${res.statusText}`);
      }
      setReport(json as ApiReport);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (urlParamsChecked) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlParamsChecked]);

  // Helper formatting function matching the Sankey component
  const money = (n: number | null | undefined, exchange: Exchange = "ANT") =>
    formatCurrency(n, exchange);

  // Extraction planets data by exchange
  const extractionPlanetsData: Record<Exchange, string | null> = {
    ANT: `TICKER  PLANET      DAILY OUTPUT
------  ----------  ------------
AMM     Romulus     33.13
AR      KI-401d     14.88
F       BS-658h      3.09
H       KI-401d     63.78
HE      CG-044d     36.63
HE3     IY-206i     16.15
N       ZV-639d     37.72
NE      BS-788c      7.70
O       KW-688c     43.34
BTS     LS-231b      8.62
H2O     KW-688c     67.41
HEX     OE-073c     35.23
LES     WU-013d      8.01
BER     SE-648b     19.04
BOR     IY-028c     14.06
BRM     IY-206j     46.20
CLI     SE-110a     40.74
GAL     KI-448c     28.04
HAL     YK-005d     28.65
LST     SE-866e     62.49
MAG     QJ-149d     20.01
MGS     QJ-382a     36.92
SCR     IA-151d     18.43
TAI     IA-151d     17.03
TCO     SE-648c     33.13
TS      XH-594c     18.41
ZIR     KI-401b     21.99
ALO     QJ-149c     46.77
AUO     QJ-650c     18.66
CUO     KI-840c     20.76
FEO     SE-110d     62.35
LIO     SE-648a     34.13
SIO     YK-649b     55.74
TIO     KI-401b     24.28`,
    CIS: null, // Add data when available
    ICA: null, // Add data when available
    NCC: null, // Add data when available
    UNV: null  // Add data when available
  };

  return (
    <>
      <style>{`
        [data-tooltip] {
          position: relative;
        }
        [data-tooltip]::after {
          content: attr(data-tooltip);
          position: absolute;
          bottom: 100%;
          left: 0;
          padding: 8px 12px;
          background-color: var(--color-bg-elevated);
          color: var(--color-accent-primary);
          font-size: 13px;
          white-space: nowrap;
          border: 1px solid var(--color-border-glow);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s;
          margin-bottom: 8px;
          z-index: 1000;
          box-shadow: var(--glow-md);
          font-family: var(--font-mono);
        }
        [data-tooltip]:hover::after {
          opacity: 1;
        }
      `}</style>

      {/* Header Section */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
          <h1 className="terminal-header" style={{ flex: 1, margin: 0, fontSize: "1.2rem", paddingBottom: 0, borderBottom: "none", fontWeight: "normal" }}>
            TICKER ANALYSIS // BEST PROFIT PER AREA SCENARIO
          </h1>
          <button
            onClick={() => setReadmeHidden(!readmeHidden)}
            className="terminal-button"
            style={{ fontSize: "0.75rem", padding: "0.5rem 1rem" }}
          >
            {readmeHidden ? "[+] Expand" : "[-] Hide"} Readme
          </button>
        </div>

        {!readmeHidden && (
          <div style={{ color: "var(--color-text-secondary)", fontSize: "0.875rem", lineHeight: "1.6" }}>
            <p style={{ marginBottom: "0.75rem" }}>
              This tool determines and displays the highest profit per area per day production scenario for one
              building producing the selected ticker (not a full base). A production scenario is the buy/make
              decision for each input in a ticker's full production chain. This model uses FIO data (refreshed hourly)
              for its calculations on optimal buy/make decisions.  Extraction mode, when enabled, uses an optimal planet (per region) 
              for extracting each raw resource (only ANT currently supported).
            </p>
            <p style={{ marginBottom: "0.75rem" }}>
              Users may force certain inputs to be made or bought, as well as force or exclude specific recipe IDs
              using the controls below. This can help explore alternative production scenarios or work around supply
              constraints. Below the main analysis is a condensed ranked table of other profitable production scenarios
              for the selected ticker, which can each be expanded to show its own sankey chart. The table is condensed to show
              only unique high-level scenarios (buy/make decisions for direct inputs only).  Below that table is a second table that displays the top 20 most profitable scenarios
              without requiring unique buy/make decisions for direct inputs.
            </p>
            <p style={{ margin: 0 }}>
              Each ticker on the sankey chain has a node and tooltip with additional info on its own profitability
              to enable users to avoid unintended opportunity costs. The flows between nodes are sized according to
              the relative proportion of an input's value to the parent's total cost; tickers with broader flows can
              be prioritized when optimizing for profitability. <span className="text-accent">Full credit to Taiyi for the Sankey inspiration.</span>
            </p>
          </div>
        )}
      </div>

      {/* Controls Section */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <div
          onClick={() => setSystemControlsCollapsed(!systemControlsCollapsed)}
          style={{
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "1rem"
          }}
        >
          <div className="terminal-header" style={{ margin: 0, paddingBottom: 0, borderBottom: "none" }}>System Controls</div>
          <span className="text-accent text-mono" style={{ fontSize: "0.875rem" }}>
            {systemControlsCollapsed ? "[+] ADVANCED" : "[-] COLLAPSE"}
          </span>
        </div>

        <div style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "80px 80px 80px 80px 1fr",
          alignItems: "end",
          marginBottom: systemControlsCollapsed ? "0.5rem" : "1.5rem"
        }}>
          <div style={{ position: "relative" }}>
            <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.5rem", color: "var(--color-accent-primary)", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>
              &nbsp;Ticker
            </label>
            <input
              value={tickerInput}
              onChange={(e) => {
                setTickerInput(e.target.value);
                setShowTickerDropdown(true);
              }}
              onFocus={() => setShowTickerDropdown(true)}
              onBlur={() => setTimeout(() => setShowTickerDropdown(false), 200)}
              className="terminal-input"
              style={{ width: "100%", textAlign: "center", fontWeight: "bold", padding: "0.70rem 1rem" }}
              placeholder="Type ticker..."
            />
            {showTickerDropdown && filteredTickers.length > 0 && (
              <div style={{
                position: "absolute",
                top: "calc(100% + 1px)",
                left: 0,
                minWidth: "200px",
                maxHeight: "300px",
                overflowY: "auto",
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-accent-primary)",
                borderRadius: "2px",
                zIndex: 9999,
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5), var(--glow-md)"
              }}>
                {filteredTickers.map((t) => (
                  <div
                    key={t}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setTickerInput(t);
                      setShowTickerDropdown(false);
                    }}
                    style={{
                      padding: "0.5rem",
                      cursor: "pointer",
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.875rem",
                      color: "var(--color-text-primary)",
                      borderBottom: "1px solid var(--color-border-secondary)",
                      transition: "all 0.2s ease"
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--color-accent-primary)";
                      e.currentTarget.style.color = "var(--color-bg-primary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--color-text-primary)";
                    }}
                  >
                    {t}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.5rem", color: "var(--color-accent-primary)", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>
              &nbsp;Exchange
            </label>
            <select
              value={exchange}
              onChange={(e) => setExchange(e.target.value as Exchange)}
              className="terminal-select"
              style={{ width: "100%", padding: "0.65rem 1rem" }}
            >
              <option value="ANT">ANT</option>
              <option value="CIS">CIS</option>
              <option value="ICA">ICA</option>
              <option value="NCC">NCC</option>
              <option value="UNV">UNV</option>
            </select>
          </div>

          <div>
            <label
              style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.5rem", color: "var(--color-accent-primary)", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}
              title={exchange !== "ANT" ? "Extraction mode only available for ANT exchange" : "Include planet-specific extraction recipes"}
            >
              Extraction
            </label>
            <button
              onClick={() => setExtractionMode(!extractionMode)}
              disabled={exchange !== "ANT"}
              className="terminal-button"
              style={{
                width: "100%",
                padding: "0.70rem 1rem",
                backgroundColor: extractionMode ? "var(--color-accent-primary)" : "transparent",
                color: extractionMode ? "var(--color-bg-primary)" : "var(--color-text-primary)",
                opacity: exchange !== "ANT" ? 0.4 : 1,
                cursor: exchange !== "ANT" ? "not-allowed" : "pointer"
              }}
              title={exchange !== "ANT" ? "Extraction mode only available for ANT exchange" : ""}
            >
              {extractionMode ? "ON" : "OFF"}
            </button>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.5rem", color: "var(--color-accent-primary)", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>
              &nbsp;Sell At
            </label>
            <select
              value={priceType}
              onChange={(e) => setPriceType(e.target.value as PriceType)}
              className="terminal-select"
              style={{ width: "100%", padding: "0.65rem 1rem" }}
            >
              <option value="ask">Ask</option>
              <option value="bid">Bid</option>
              <option value="pp7">PP7</option>
              <option value="pp30">PP30</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.5rem", fontFamily: "var(--font-mono)" }}>
              {exchange === "ANT" ? <span className="status-success" style={{ fontSize: "0.75rem" }}>&nbsp;◉ OPTIMAL_EXCHANGE</span> : <span className="status-error" style={{ fontSize: "0.75rem" }}>◉ SUBOPTIMAL_EXCHANGE</span>}
            </label>
            <button
              onClick={run}
              disabled={loading || !tickerInput.trim()}
              className="terminal-button"
              style={{ padding: "0.70rem 1rem", width: "100%" }}
            >
              {loading ? <span className="terminal-loading">Processing</span> : "Execute"}
            </button>
          </div>
        </div>

        {!systemControlsCollapsed && (<>
        {/* Force Make/Buy Controls */}
        <div style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "1fr 1fr",
          marginBottom: "1rem"
        }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.5rem", color: "var(--color-accent-primary)", textTransform: "uppercase" }}>
              Force Make (comma-separated)
            </label>
            <input
              type="text"
              value={forceMake}
              onChange={(e) => setForceMake(e.target.value)}
              placeholder="e.g., C, H2O, PE"
              className="terminal-input"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.5rem", color: "var(--color-accent-primary)", textTransform: "uppercase" }}>
              Force Buy (comma-separated)
            </label>
            <input
              type="text"
              value={forceBuy}
              onChange={(e) => setForceBuy(e.target.value)}
              placeholder="e.g., H, O, FE"
              className="terminal-input"
              style={{ width: "100%" }}
            />
          </div>
        </div>

        {/* Force/Exclude Recipe Controls */}
        <div style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "1fr 1fr",
          marginBottom: "1rem"
        }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.5rem", color: "var(--color-accent-primary)", textTransform: "uppercase" }}>
              Force RecipeID (comma-separated)
            </label>
            <input
              type="text"
              value={forceRecipe}
              onChange={(e) => setForceRecipe(e.target.value)}
              placeholder="e.g., C_5, CL_2, HCP_1"
              className="terminal-input"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.5rem", color: "var(--color-accent-primary)", textTransform: "uppercase" }}>
              Exclude RecipeID (comma-separated)
            </label>
            <input
              type="text"
              value={excludeRecipe}
              onChange={(e) => setExcludeRecipe(e.target.value)}
              placeholder="e.g., C_1, CL_3"
              className="terminal-input"
              style={{ width: "100%" }}
            />
          </div>
        </div>

        {/* Recipe List Toggle - Moved to bottom of system controls */}
        <div style={{ marginTop: "1rem" }}>
          <div
            onClick={() => setShowRecipeList(!showRecipeList)}
            style={{
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.5rem",
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "2px",
              transition: "all 0.2s ease"
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = "var(--color-border-glow)"}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--color-border-primary)"}
          >
            <span className="text-accent text-mono" style={{ fontSize: "0.875rem" }}>
              {showRecipeList ? "[-]" : "[+]"} RECIPE DATABASE
            </span>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              {showRecipeList ? "COLLAPSE" : "EXPAND"}
            </span>
          </div>
          {showRecipeList && (
            <div style={{
              marginTop: "0.5rem",
              padding: "1rem",
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-secondary)",
              borderRadius: "2px",
              maxHeight: "400px",
              overflowY: "auto"
            }}>
              <pre style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
                lineHeight: "1.6",
                color: "var(--color-text-secondary)"
              }}>
                {`Only materials with multiple recipes are listed here to provide recipe IDs:

AL_1 - SME: 6xALO-1xC-1xO=>3xAL
AL_2 - SME: 6xALO-1xC-1xFLX-1xO=>4xAL
BBH_1 - PP1: 2xFE-1xLST=>1xBBH
BBH_2 - PP2: 2xAL-1xLST=>1xBBH
BDE_1 - PP1: 150xPE=>1xBDE
BDE_2 - PP2: 40xPG=>1xBDE
BEA_1 - FRM: 1xH2O=>2xBEA
BEA_2 - FRM: 6xH2O=>4xBEA
BLE_1 - LAB: 10xNAB-2xO-3xS=>4xBLE
BLE_2 - LAB: 1xCL-1xNA-1xO=>3xBLE
BSE_1 - PP1: 1xFE-2xLST=>1xBSE
BSE_2 - PP2: 1xAL-2xLST=>1xBSE
BTA_1 - PP1: 1xFE-50xPE=>1xBTA
BTA_2 - PP2: 1xAL-1xGL=>1xBTA
C_1 - INC: 4xGRN=>4xC
C_2 - INC: 2xGRN-4xHCP-2xMAI=>4xC
C_3 - INC: 2xGRN-4xHCP=>4xC
C_4 - INC: 4xHCP-2xMAI=>4xC
C_5 - INC: 4xHCP=>4xC
C_6 - INC: 4xMAI=>4xC
DRF_1 - DRS: 1xDCS-50xNFI=>1xDRF
DRF_2 - WEL: 6xAL-1xHE=>1xDRF
DW_1 - FP: 10xH2O-1xPG=>10xDW
DW_2 - FP: 10xH2O=>7xDW
EXO_1 - BMP: 1xAL-1xMFK-10xOVE=>10xEXO
EXO_2 - BMP: 1xAL-10xOVE-1xSWF=>10xEXO
EXO_3 - BMP: 1xAL-10xOVE=>10xEXO
FE_1 - SME: 1xC-6xFEO-1xFLX-1xO=>4xFE
FE_2 - SME: 1xC-6xFEO-1xO=>3xFE
GL_1 - GF: 1xFLX-1xNA-2xSIO=>12xGL
GL_2 - GF: 1xNA-1xSEN-2xSIO=>10xGL
GL_3 - GF: 1xNA-2xSIO=>10xGL
GRA_1 - RC: 1xDDT-30xH2O-3xSOI=>6xGRA
GRA_2 - ORC: 1xDDT-40xH2O=>5xGRA
GRN_1 - FRM: 1xH2O=>4xGRN
GRN_2 - FRM: 4xH2O=>4xGRN
HCP_1 - FRM: 2xH2O=>4xHCP
HCP_2 - HYF: 14xH2O-1xNS=>8xHCP
HOP_1 - ORC: 2xDDT-40xH2O-4xSOI=>18xHOP
HOP_2 - ORC: 2xDDT-60xH2O=>15xHOP
MAI_1 - FRM: 4xH2O=>12xMAI
MAI_2 - HYF: 20xH2O-2xNS=>12xMAI
MUS_1 - HYF: 1xNS=>4xMUS
MUS_2 - HYF: 4xNS=>12xMUS
OVE_1 - BMP: 100xPE-25xPG=>20xOVE
OVE_2 - BMP: 1xCOT-10xPG=>30xOVE
OVE_3 - BMP: 50xPE-1xRCO=>20xOVE
PIB_1 - ORC: 1xDDT-20xH2O-2xSOI=>12xPIB
PIB_2 - ORC: 1xDDT-30xH2O=>10xPIB
PPA_1 - FP: 1xALG-1xBEA-1xH2O=>6xPPA
PPA_2 - FP: 2xALG-1xH2O=>4xPPA
PPA_3 - FP: 2xBEA-1xH2O=>4xPPA
PT_1 - BMP: 1xSTL-1xTRN=>7xPT
PT_2 - BMP: 1xSTL-1xW=>15xPT
PT_3 - BMP: 2xSFK-1xSTL=>6xPT
PT_4 - BMP: 1xSTL=>5xPT
RAT_1 - FP: 1xALG-1xGRN-1xNUT=>10xRAT
RAT_2 - FP: 1xALG-1xGRN-1xVEG=>10xRAT
RAT_3 - FP: 1xBEA-1xGRN-1xNUT=>10xRAT
RAT_4 - FP: 1xBEA-1xGRN-1xVEG=>10xRAT
RAT_5 - FP: 1xALG-1xMAI-1xNUT=>10xRAT
RAT_6 - FP: 1xALG-1xMAI-1xVEG=>10xRAT
RAT_7 - FP: 1xBEA-1xMAI-1xNUT=>10xRAT
RAT_8 - FP: 1xBEA-1xMAI-1xVEG=>10xRAT
RAT_9 - FP: 1xGRN-1xMUS-1xNUT=>10xRAT
RAT_10 - FP: 1xMAI-1xMUS-1xNUT=>10xRAT
RAT_11 - FP: 1xGRN-1xMUS-1xVEG=>10xRAT
RAT_12 - FP: 1xMAI-1xMUS-1xVEG=>10xRAT
RCO_1 - FRM: 2xH2O-4xNS=>2xRCO
RCO_2 - FRM: 2xH2O=>1xRCO
RCO_3 - HYF: 10xH2O-4xNS=>2xRCO
RG_1 - GF: 10xGL-15xPG-1xSEN=>10xRG
RG_2 - GF: 10xGL-15xPG=>10xRG
SF_1 - REF: 1xAMM-2xGAL-3xH=>100xSF
SF_2 - REF: 1xAMM-5xNAB=>150xSF
SI_1 - SME: 1xAL-3xSIO=>1xSI
SI_2 - SME: 1xC-1xFLX-1xO-3xSIO=>1xSI
SI_3 - SME: 1xC-1xO-3xSIO=>1xSI
SI_4 - SME: 1xAL-1xO-4xTS=>1xSI
VEG_1 - FRM: 3xH2O=>4xVEG
VEG_2 - HYF: 16xH2O-1xNS=>6xVEG`}
              </pre>
            </div>
          )}
        </div>

        {/* Extraction Planets Toggle */}
        <div style={{ marginTop: "1rem" }}>
          <div
            onClick={() => extractionPlanetsData[exchange] && setShowExtractionPlanets(!showExtractionPlanets)}
            title={!extractionPlanetsData[exchange] ? `Extraction planets data not available for ${exchange} exchange` : ""}
            style={{
              cursor: extractionPlanetsData[exchange] ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.5rem",
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "2px",
              transition: "all 0.2s ease",
              opacity: extractionPlanetsData[exchange] ? 1 : 0.4
            }}
            onMouseEnter={(e) => extractionPlanetsData[exchange] && (e.currentTarget.style.borderColor = "var(--color-border-glow)")}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--color-border-primary)"}
          >
            <span className="text-accent text-mono" style={{ fontSize: "0.875rem" }}>
              {showExtractionPlanets ? "[-]" : "[+]"} EXTRACTION PLANETS {!extractionPlanetsData[exchange] && `(${exchange} N/A)`}
            </span>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              {showExtractionPlanets ? "COLLAPSE" : "EXPAND"}
            </span>
          </div>
          {showExtractionPlanets && extractionPlanetsData[exchange] && (
            <div style={{
              marginTop: "0.5rem",
              padding: "1rem",
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-secondary)",
              borderRadius: "2px",
              maxHeight: "400px",
              overflowY: "auto"
            }}>
              <pre style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
                lineHeight: "1.6",
                color: "var(--color-text-secondary)"
              }}>
                {extractionPlanetsData[exchange]}
              </pre>
            </div>
          )}
        </div>
        </>)}
      </div>

      {/* Error Display */}
      {error && (
        <div className="terminal-box" style={{ borderColor: "var(--color-error)", marginBottom: "2rem" }}>
          <div className="status-error" style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem" }}>
            ERROR: {error}
          </div>
        </div>
      )}

      {report && report.error && (
        <div className="terminal-box" style={{ borderColor: "var(--color-error)", marginBottom: "2rem" }}>
          <div className="status-error" style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem" }}>
            ERROR: {report.error}
          </div>
        </div>
      )}

      {/* Results Section */}
      {report && !error && !report.error && report.best && (
        <>
          {/* Summary Box - Collapsible */}
          <div className="terminal-box" style={{ marginBottom: "2rem" }}>
            <div
              onClick={() => setAnalysisCollapsed(!analysisCollapsed)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                marginBottom: analysisCollapsed ? 0 : "1rem"
              }}
            >
              <div className="terminal-header" style={{ margin: 0 }}>Analysis Results</div>
              <span className="text-mono" style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
                {analysisCollapsed ? "[+] EXPAND" : "[-] COLLAPSE"}
              </span>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "1rem",
              marginBottom: analysisCollapsed ? 0 : "1rem",
              padding: "1rem",
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-secondary)",
              borderRadius: "2px"
            }}>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", textTransform: "uppercase", marginBottom: "0.25rem", fontFamily: "var(--font-mono)" }}>
                  Ticker
                </div>
                <div className="text-accent" style={{ fontSize: "1.5rem", fontFamily: "var(--font-mono)", fontWeight: "bold" }}>
                  {report.ticker}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", textTransform: "uppercase", marginBottom: "0.25rem", fontFamily: "var(--font-mono)" }}>
                  Best P/A
                </div>
                <div className="status-success" style={{ fontSize: "1.5rem", fontFamily: "var(--font-mono)", fontWeight: "bold" }}>
                  {formatCurrency(report.bestPA, report.exchange)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", textTransform: "uppercase", marginBottom: "0.25rem", fontFamily: "var(--font-mono)" }}>
                  Options Evaluated
                </div>
                <div style={{ fontSize: "1.5rem", fontFamily: "var(--font-mono)", color: "var(--color-text-primary)", fontWeight: "bold" }}>
                  {report.totalOptions.toLocaleString()}
                </div>
              </div>
            </div>

            {!analysisCollapsed && (
              <>
              <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.875rem", fontFamily: "var(--font-mono)" }}>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <span
                    data-tooltip="The daily profit generated by a single building production chain of this ticker in this scenario."
                    style={{ cursor: "help", color: "var(--color-accent-secondary)" }}
                  >
                    [i]
                  </span>
                  <span style={{ color: "var(--color-text-secondary)" }}>Chain Profit/Day:</span>
                  <span className="text-accent">{money(report.best.baseProfitPerDay, report.exchange)}</span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <span
                    data-tooltip="Cost of Goods Made for one count of this ticker."
                    style={{ cursor: "help", color: "var(--color-accent-secondary)" }}
                  >
                    [i]
                  </span>
                  <span style={{ color: "var(--color-text-secondary)" }}>COGM:</span>
                  <span className="text-accent">{money(report.best.cogmPerOutput, report.exchange)}</span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <span
                    data-tooltip="The area of the production building and the proportionate area of input production buildings needed for one day's production of this ticker in this scenario."
                    style={{ cursor: "help", color: "var(--color-accent-secondary)" }}
                  >
                    [i]
                  </span>
                  <span style={{ color: "var(--color-text-secondary)" }}>Total Area/Day:</span>
                  <span className="text-accent">
                    {report.best.totalAreaPerDay != null && Number.isFinite(report.best.totalAreaPerDay)
                      ? report.best.totalAreaPerDay.toFixed(1).replace(/\.0$/, "")
                      : "n/a"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <span
                    data-tooltip="The number of orders that the production building will complete each day at full efficiency (160.5%)."
                    style={{ cursor: "help", color: "var(--color-accent-secondary)" }}
                  >
                    [i]
                  </span>
                  <span style={{ color: "var(--color-text-secondary)" }}>Orders/day:</span>
                  <span className="text-accent">
                    {report.best.runsPerDay != null && Number.isFinite(report.best.runsPerDay)
                      ? report.best.runsPerDay.toFixed(1).replace(/\.0$/, "")
                      : "n/a"}
                  </span>
                </div>
                {(report.best.buildCost != null || report.best.roiNarrowDays != null) && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <span
                      data-tooltip="The build cost for the production building and the proportionate build cost of needed habitation buildings and the core module, as well as the expected time needed to reach a ROI."
                      style={{ cursor: "help", color: "var(--color-accent-secondary)" }}
                    >
                      [i]
                    </span>
                    <span style={{ color: "var(--color-text-secondary)" }}>Build Cost - Narrow (ROI):</span>
                    <span className="text-accent">
                      {money(report.best.buildCost, report.exchange)} ({Number.isFinite(report.best.roiNarrowDays)
                        ? report.best.roiNarrowDays.toFixed(1).replace(/\.0$/, "")
                        : "n/a"} days)
                    </span>
                  </div>
                )}
                {(report.best.totalBuildCost != null || report.best.roiBroadDays != null) && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <span
                      data-tooltip="The narrow build cost plus the proportionate build cost of all input production and habitation buildings needed for one day's production for this production chain"
                      style={{ cursor: "help", color: "var(--color-accent-secondary)" }}
                    >
                      [i]
                    </span>
                    <span style={{ color: "var(--color-text-secondary)" }}>Build Cost - Broad (ROI):</span>
                    <span className="text-accent">
                      {money(report.best.totalBuildCost, report.exchange)} ({Number.isFinite(report.best.roiBroadDays)
                        ? report.best.roiBroadDays.toFixed(1).replace(/\.0$/, "")
                        : "n/a"} days)
                    </span>
                  </div>
                )}
                {(report.best.inputBuffer7 != null || report.best.inputPaybackDays7Narrow != null) && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <span
                      data-tooltip="Total cost of workforce and production inputs needed to keep the production building running for 7 days, as well as the expected time needed to reach a ROI."
                      style={{ cursor: "help", color: "var(--color-accent-secondary)" }}
                    >
                      [i]
                    </span>
                    <span style={{ color: "var(--color-text-secondary)" }}>Input Buffer 7d - Narrow (Payback):</span>
                    <span className="text-accent">
                      {money(report.best.inputBuffer7, report.exchange)} ({Number.isFinite(report.best.inputPaybackDays7Narrow)
                        ? report.best.inputPaybackDays7Narrow.toFixed(1).replace(/\.0$/, "")
                        : "n/a"} days)
                    </span>
                  </div>
                )}
                {(report.best.totalInputBuffer7 != null || report.best.inputPaybackDays7Broad != null) && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <span
                      data-tooltip="Total cost of workforce and production inputs needed to keep all stages' production buildings running for 7 days, as well as the expected time needed to reach a ROI."
                      style={{ cursor: "help", color: "var(--color-accent-secondary)" }}
                    >
                      [i]
                    </span>
                    <span style={{ color: "var(--color-text-secondary)" }}>Input Buffer 7d - Broad (Payback):</span>
                    <span className="text-accent">
                      {money(report.best.totalInputBuffer7, report.exchange)} ({Number.isFinite(report.best.inputPaybackDays7Broad)
                        ? report.best.inputPaybackDays7Broad.toFixed(1).replace(/\.0$/, "")
                        : "n/a"} days)
                    </span>
                  </div>
                )}
                {report.best.scenario && (
                  <div style={{ marginTop: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border-secondary)", fontStyle: "italic", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                    Full Scenario: {report.best.scenario}
                  </div>
                )}
              </div>
              </>
            )}

            {/* Sankey Chart - Always visible, even when analysis is collapsed */}
            <div style={{ marginTop: "1rem" }}>
              <BestScenarioSankey best={report.best} exchange={report.exchange} priceType={report.priceType} />
            </div>
          </div>

          {/* Tables Section */}
          <div className="terminal-box" style={{ marginBottom: "2rem" }}>
            <div className="terminal-header">Best Options - Condensed</div>
            <p style={{ margin: "0 0 1rem 0", color: "var(--color-text-secondary)", fontSize: "0.875rem" }}>
              Best performing option for each unique high-level scenario (up to 20). This condensed table only shows scenarios where the buy/make decisions for direct inputs, not their sub-components, are unique.
            </p>
            <CondensedOptionsTable options={report.topDisplayScenarios} exchange={report.exchange} priceType={report.priceType} />
          </div>

          <div className="terminal-box">
            <div className="terminal-header">Best Options - Expanded</div>
            <p style={{ margin: "0 0 1rem 0", color: "var(--color-text-secondary)", fontSize: "0.875rem" }}>
              List of the top 20 production scenarios ranked by profit per area without requiring unique buy/make combinations for high-level inputs.
            </p>
            <Top20Table options={report.top20} exchange={report.exchange} priceType={report.priceType} />
          </div>
        </>
      )}

      {report && !error && !report.error && !report.best && (
        <div className="terminal-box">
          <div style={{ color: "var(--color-warning)", fontFamily: "var(--font-mono)" }}>
            No best scenario available for this ticker.
          </div>
        </div>
      )}

    </>
  );
}

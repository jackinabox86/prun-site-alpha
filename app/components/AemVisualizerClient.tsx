"use client";

import { useEffect, useMemo, useState } from "react";
import AemSankey from "./AemSankey";
import { buildChain, type RecipeMap, type ChainNode } from "@/core/aemChainBuilder";

interface AemDataResponse {
  recipes: RecipeMap;
  tickers: string[];
  error?: string;
}

export default function AemVisualizerClient() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [tickerInput, setTickerInput] = useState<string>("CBS");
  const [forceRecipe, setForceRecipe] = useState<string>("");
  const [showTickerDropdown, setShowTickerDropdown] = useState(false);
  const [readmeHidden, setReadmeHidden] = useState(false);

  const [loading, setLoading] = useState(false);
  const [recipeMap, setRecipeMap] = useState<RecipeMap | null>(null);
  const [chain, setChain] = useState<ChainNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Load recipe data on mount
  useEffect(() => {
    setLoading(true);
    fetch("/api/aem-data", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load recipe data"))))
      .then((data: AemDataResponse) => {
        if (data.error) {
          throw new Error(data.error);
        }
        setRecipeMap(data.recipes);
        setTickers(data.tickers ?? []);
        setDataLoaded(true);
      })
      .catch((err) => {
        setError(err?.message ?? "Failed to load recipe data");
        setTickers([]);
      })
      .finally(() => setLoading(false));
  }, []);

  // Build chain when ticker or force recipe changes
  useEffect(() => {
    if (!recipeMap || !tickerInput.trim()) {
      setChain(null);
      return;
    }

    const ticker = tickerInput.trim().toUpperCase();
    const result = buildChain(ticker, recipeMap, forceRecipe);

    if (result.error) {
      setError(result.error);
      setChain(null);
    } else {
      setError(null);
      setChain(result.root);
    }
  }, [recipeMap, tickerInput, forceRecipe]);

  const filteredTickers = useMemo(() => {
    if (!tickerInput) return tickers.slice(0, 50);
    const q = tickerInput.toUpperCase();
    return tickers.filter((t) => t.toUpperCase().startsWith(q)).slice(0, 50);
  }, [tickers, tickerInput]);

  const handleExecute = () => {
    if (!recipeMap || !tickerInput.trim()) return;

    const ticker = tickerInput.trim().toUpperCase();
    const result = buildChain(ticker, recipeMap, forceRecipe);

    if (result.error) {
      setError(result.error);
      setChain(null);
    } else {
      setError(null);
      setChain(result.root);
    }
  };

  return (
    <>
      {/* Header Section */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
          <h1
            className="terminal-header"
            style={{
              flex: 1,
              margin: 0,
              fontSize: "1.2rem",
              paddingBottom: 0,
              borderBottom: "none",
              fontWeight: "normal",
            }}
          >
            AEM VISUALIZER // PRODUCTION CHAIN STRUCTURE
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
              This tool visualizes production chains as a Sankey diagram showing the structure of how materials
              are made. Unlike the main Ticker Analysis, this shows a pure MAKE-only view - all inputs are
              assumed to be self-produced rather than bought from the market.
            </p>
            <p style={{ marginBottom: "0.75rem" }}>
              The chart displays equal-width links since no cost/profit calculations are performed. This is
              useful for understanding the full production tree of any material, identifying deep dependency
              chains, and exploring recipe options.
            </p>
            <p style={{ margin: 0 }}>
              <span className="text-accent">Orange nodes</span> indicate MAKE decisions with valid recipes.{" "}
              <span style={{ color: "#ff4444" }}>Red nodes</span> indicate raw materials (no recipe) or errors
              (missing recipes, circular dependencies).
            </p>
          </div>
        )}
      </div>

      {/* Controls Section */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <div className="terminal-header" style={{ marginBottom: "1rem" }}>
          System Controls
        </div>

        <div
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "120px 1fr 120px",
            alignItems: "end",
            marginBottom: "1rem",
          }}
        >
          <div style={{ position: "relative" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.75rem",
                marginBottom: "0.5rem",
                color: "var(--color-accent-primary)",
                textTransform: "uppercase",
                fontFamily: "var(--font-mono)",
              }}
            >
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
              <div
                style={{
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
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5), var(--glow-md)",
                }}
              >
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
                      transition: "all 0.2s ease",
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
            <label
              style={{
                display: "block",
                fontSize: "0.75rem",
                marginBottom: "0.5rem",
                color: "var(--color-accent-primary)",
                textTransform: "uppercase",
                fontFamily: "var(--font-mono)",
              }}
            >
              Force Recipe IDs (comma-separated)
            </label>
            <input
              type="text"
              value={forceRecipe}
              onChange={(e) => setForceRecipe(e.target.value)}
              placeholder="e.g., C_5, HCP_2, AL_1"
              className="terminal-input"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.75rem",
                marginBottom: "0.5rem",
                fontFamily: "var(--font-mono)",
              }}
            >
              {dataLoaded ? (
                <span className="status-success" style={{ fontSize: "0.75rem" }}>
                  &nbsp;DATA_LOADED
                </span>
              ) : (
                <span className="status-error" style={{ fontSize: "0.75rem" }}>
                  LOADING...
                </span>
              )}
            </label>
            <button
              onClick={handleExecute}
              disabled={loading || !tickerInput.trim() || !dataLoaded}
              className="terminal-button"
              style={{ padding: "0.70rem 1rem", width: "100%" }}
            >
              {loading ? <span className="terminal-loading">Processing</span> : "Execute"}
            </button>
          </div>
        </div>

        {/* Recipe reference section */}
        <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          <details>
            <summary style={{ cursor: "pointer", color: "var(--color-accent-secondary)" }}>
              [+] RECIPE ID REFERENCE
            </summary>
            <pre
              style={{
                marginTop: "0.5rem",
                padding: "1rem",
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border-secondary)",
                borderRadius: "2px",
                maxHeight: "300px",
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                fontFamily: "var(--font-mono)",
                lineHeight: "1.6",
              }}
            >
              {`AL_1 - SME: 6xALO-1xC-1xO=>3xAL
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
          </details>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="terminal-box" style={{ borderColor: "var(--color-error)", marginBottom: "2rem" }}>
          <div className="status-error" style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem" }}>
            ERROR: {error}
          </div>
        </div>
      )}

      {/* Results Section */}
      {chain && !error && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div className="terminal-header" style={{ marginBottom: "1rem" }}>
            Production Chain: {tickerInput.toUpperCase()}
          </div>

          <div
            style={{
              padding: "1rem",
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-secondary)",
              borderRadius: "2px",
              marginBottom: "1rem",
            }}
          >
            <div style={{ display: "flex", gap: "2rem", fontSize: "0.875rem", fontFamily: "var(--font-mono)" }}>
              <div>
                <span style={{ color: "var(--color-text-muted)" }}>Root Recipe:</span>{" "}
                <span className="text-accent">{chain.recipeId || "N/A"}</span>
              </div>
              <div>
                <span style={{ color: "var(--color-text-muted)" }}>Building:</span>{" "}
                <span className="text-accent">{chain.building || "N/A"}</span>
              </div>
              <div>
                <span style={{ color: "var(--color-text-muted)" }}>Direct Inputs:</span>{" "}
                <span className="text-accent">{chain.inputs.length}</span>
              </div>
            </div>
          </div>

          {/* Sankey Chart */}
          <AemSankey chain={chain} />
        </div>
      )}

      {!chain && !error && dataLoaded && (
        <div className="terminal-box">
          <div style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
            Enter a ticker and click Execute to visualize its production chain.
          </div>
        </div>
      )}
    </>
  );
}

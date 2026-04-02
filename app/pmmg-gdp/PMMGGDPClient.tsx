"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { GDPPoint, GDPApiResponse } from "../api/pmmg-gdp/route";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

export default function PMMGGDPClient() {
  const [data, setData] = useState<GDPPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pmmg-gdp")
      .then((res) => res.json())
      .then((json: GDPApiResponse) => {
        if (json.error) {
          setError(json.error);
        } else {
          setData(json.data);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to fetch"))
      .finally(() => setLoading(false));
  }, []);

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
        PMMG GDP
      </h1>
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.875rem",
          color: "var(--color-text-muted)",
          marginBottom: "1.5rem",
        }}
      >
        Total production volume across all items per month
      </p>

      {loading && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            color: "var(--color-text-muted)",
          }}
        >
          Loading production data...
        </div>
      )}

      {error && (
        <div
          className="terminal-box"
          style={{
            padding: "1rem",
            color: "var(--color-error)",
            borderColor: "var(--color-error)",
          }}
        >
          Error: {error}
        </div>
      )}

      {!loading && !error && data.length > 0 && (() => {
        const ONE_B = 1_000_000_000;
        const maxVol = Math.max(...data.map((d) => d.totalVolume));
        const yMax = maxVol * 1.08;

        // Generate tick values from 1b up, choosing a sensible interval
        const range = yMax - ONE_B;
        const rawInterval = range / 5;
        const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
        const tickInterval = Math.ceil(rawInterval / magnitude) * magnitude;

        const tickvals: number[] = [];
        for (let v = ONE_B; v <= yMax; v += tickInterval) {
          tickvals.push(Math.round(v));
        }

        const fmtB = (v: number) => {
          const b = v / ONE_B;
          const s = parseFloat(b.toFixed(2)).toString();
          return `ȼ${s}b`;
        };
        const ticktext = tickvals.map(fmtB);

        return (
          <div className="terminal-box" style={{ padding: "1rem" }}>
            <Plot
              data={[
                {
                  type: "bar",
                  x: data.map((d) => d.monthLabel),
                  y: data.map((d) => d.totalVolume),
                  marker: { color: "#ff9500" },
                  hovertemplate: "%{x}<br>ȼ%{y:,.0f}<extra></extra>",
                },
              ]}
              layout={{
                paper_bgcolor: "#0a0e14",
                plot_bgcolor: "#101419",
                font: { color: "#e6e8eb", family: "monospace" },
                xaxis: {
                  gridcolor: "#1a2332",
                  tickangle: -45,
                  linecolor: "#2a3f5f",
                },
                yaxis: {
                  gridcolor: "#1a2332",
                  linecolor: "#2a3f5f",
                  range: [ONE_B, yMax],
                  tickvals,
                  ticktext,
                },
                annotations: [
                  {
                    text: "Total Production Volume",
                    xref: "paper",
                    yref: "paper",
                    x: 0,
                    y: 1.06,
                    xanchor: "left",
                    yanchor: "bottom",
                    showarrow: false,
                    font: { color: "#a0a8b5", size: 12, family: "monospace" },
                  },
                ],
                margin: { t: 50, b: 120, l: 70, r: 20 },
                bargap: 0.3,
              }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%", height: "500px" }}
            />
          </div>
        );
      })()}
    </div>
  );
}

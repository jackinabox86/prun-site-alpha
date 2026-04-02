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

      {!loading && !error && data.length > 0 && (
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
                tickprefix: "ȼ",
                tickformat: ",.0f",
                linecolor: "#2a3f5f",
                title: { text: "Total Production Volume" },
              },
              margin: { t: 40, b: 120, l: 100, r: 20 },
              bargap: 0.3,
            }}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: "100%", height: "500px" }}
          />
        </div>
      )}
    </div>
  );
}

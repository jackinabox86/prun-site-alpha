"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { MMSPoint, MMSApiResponse } from "../api/pmmg-mms/route";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

export default function PMMGMMSClient() {
  const [data, setData] = useState<MMSPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pmmg-mms")
      .then((res) => res.json())
      .then((json: MMSApiResponse) => {
        if (json.error) {
          setError(json.error);
        } else {
          setData(json.data);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to fetch"))
      .finally(() => setLoading(false));
  }, []);

  const months = data.map((d) => d.monthLabel);

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
        PMMG MMS
      </h1>
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.875rem",
          color: "var(--color-text-muted)",
          marginBottom: "1.5rem",
        }}
      >
        Share of production volume by material category
      </p>

      {loading && (
        <div style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}>
          Loading production data...
        </div>
      )}

      {error && (
        <div
          className="terminal-box"
          style={{ padding: "1rem", color: "var(--color-error)", borderColor: "var(--color-error)" }}
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
                name: "New MMs (AIR, CCD, LOG)",
                x: months,
                y: data.map((d) => d.newMMPct),
                marker: { color: "#00ff88" },
                hovertemplate: "%{fullData.name}<br>%{y:.1f}%<extra></extra>",
              },
              {
                type: "bar",
                name: "Old MMs (IDC, EDC)",
                x: months,
                y: data.map((d) => d.oldMMPct),
                marker: { color: "#ff9500" },
                hovertemplate: "%{fullData.name}<br>%{y:.1f}%<extra></extra>",
              },
              {
                type: "bar",
                name: "All Others",
                x: months,
                y: data.map((d) => d.otherPct),
                marker: { color: "#3d9cdb" },
                hovertemplate: "%{fullData.name}<br>%{y:.1f}%<extra></extra>",
              },
            ]}
            layout={{
              barmode: "stack",
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
                range: [0, 100],
                dtick: 10,
                ticksuffix: "%",
              },
              legend: {
                x: 1,
                xanchor: "right",
                y: 1,
                yanchor: "top",
                bgcolor: "#0a0e14",
                bordercolor: "#2a3f5f",
                borderwidth: 1,
              },
              showlegend: true,
              margin: { t: 20, b: 120, l: 60, r: 20 },
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

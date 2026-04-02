"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { MMSPoint, MMSApiResponse } from "../api/pmmg-mms/route";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type ChartType = "share" | "absolute";

const LEGEND = {
  x: 0,
  xanchor: "left" as const,
  y: 1,
  yanchor: "top" as const,
  bgcolor: "#0a0e14",
  bordercolor: "#2a3f5f",
  borderwidth: 1,
};

const BASE_LAYOUT = {
  paper_bgcolor: "#0a0e14",
  plot_bgcolor: "#101419",
  font: { color: "#e6e8eb", family: "monospace" },
  xaxis: { gridcolor: "#1a2332", tickangle: -45, linecolor: "#2a3f5f" },
  showlegend: true,
  legend: LEGEND,
  bargap: 0.3,
};

function buildTicksFromZero(maxVol: number) {
  const ONE_B = 1_000_000_000;
  const yMax = maxVol * 1.08;
  const rawInterval = yMax / 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const tickInterval = Math.ceil(rawInterval / magnitude) * magnitude;
  const tickvals: number[] = [];
  for (let v = 0; v <= yMax; v += tickInterval) tickvals.push(Math.round(v));
  const fmtB = (v: number) => {
    const b = v / ONE_B;
    return `ȼ${parseFloat(b.toFixed(2))}b`;
  };
  return { tickvals, ticktext: tickvals.map(fmtB), yMax };
}

export default function PMMGMMSClient() {
  const [data, setData] = useState<MMSPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>("share");

  useEffect(() => {
    fetch("/api/pmmg-mms")
      .then((res) => res.json())
      .then((json: MMSApiResponse) => {
        if (json.error) setError(json.error);
        else setData(json.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to fetch"))
      .finally(() => setLoading(false));
  }, []);

  const months = data.map((d) => d.monthLabel);

  const shareChart = (
    <Plot
      data={[
        {
          type: "bar", name: "New MMs (AIR, CCD, LOG)", x: months,
          y: data.map((d) => d.newMMPct),
          marker: { color: "#00ff88" },
          hovertemplate: "%{fullData.name}<br>%{y:.1f}%<extra></extra>",
        },
        {
          type: "bar", name: "Old MMs (IDC, EDC)", x: months,
          y: data.map((d) => d.oldMMPct),
          marker: { color: "#ff9500" },
          hovertemplate: "%{fullData.name}<br>%{y:.1f}%<extra></extra>",
        },
        {
          type: "bar", name: "All Others", x: months,
          y: data.map((d) => d.otherPct),
          marker: { color: "#3d9cdb" },
          hovertemplate: "%{fullData.name}<br>%{y:.1f}%<extra></extra>",
        },
      ]}
      layout={{
        ...BASE_LAYOUT,
        barmode: "stack",
        yaxis: {
          gridcolor: "#1a2332", linecolor: "#2a3f5f",
          range: [0, 100], dtick: 10, ticksuffix: "%",
        },
        margin: { t: 20, b: 120, l: 60, r: 20 },
      }}
      config={{ responsive: true, displayModeBar: false }}
      style={{ width: "100%", height: "500px" }}
    />
  );

  const absoluteChart = () => {
    const maxTotal = Math.max(
      ...data.map((d) => (d.newMMVol + d.oldMMVol + d.otherVol) * 30)
    );
    const { tickvals, ticktext, yMax } = buildTicksFromZero(maxTotal);
    return (
      <Plot
        data={[
          // Bottom → top: All Others, Old MMs, New MMs
          {
            type: "bar", name: "All Others", x: months,
            y: data.map((d) => d.otherVol * 30),
            marker: { color: "#3d9cdb" },
            hovertemplate: "%{fullData.name}<br>ȼ%{y:,.0f}<extra></extra>",
          },
          {
            type: "bar", name: "Old MMs (IDC, EDC)", x: months,
            y: data.map((d) => d.oldMMVol * 30),
            marker: { color: "#ff9500" },
            hovertemplate: "%{fullData.name}<br>ȼ%{y:,.0f}<extra></extra>",
          },
          {
            type: "bar", name: "New MMs (AIR, CCD, LOG)", x: months,
            y: data.map((d) => d.newMMVol * 30),
            marker: { color: "#00ff88" },
            hovertemplate: "%{fullData.name}<br>ȼ%{y:,.0f}<extra></extra>",
          },
        ]}
        layout={{
          ...BASE_LAYOUT,
          barmode: "stack",
          yaxis: {
            gridcolor: "#1a2332", linecolor: "#2a3f5f",
            range: [0, yMax], tickvals, ticktext,
          },
          margin: { t: 20, b: 120, l: 70, r: 20 },
        }}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: "100%", height: "500px" }}
      />
    );
  };

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

      <div style={{ marginBottom: "1.5rem", display: "flex", gap: "0.5rem" }}>
        <button
          className="terminal-button"
          onClick={() => setChartType("share")}
          style={{ opacity: chartType === "share" ? 1 : 0.5 }}
        >
          % Share
        </button>
        <button
          className="terminal-button"
          onClick={() => setChartType("absolute")}
          style={{ opacity: chartType === "absolute" ? 1 : 0.5 }}
        >
          Absolute Volume
        </button>
      </div>

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
          {chartType === "share" ? shareChart : absoluteChart()}
        </div>
      )}
    </div>
  );
}

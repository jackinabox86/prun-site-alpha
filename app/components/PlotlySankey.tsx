"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Type guard for Plotly loaded on window
function getPlotly(): any {
  if (typeof window === "undefined") return null;
  return (window as any).Plotly;
}

const PLOTLY_CDN = "https://cdn.plot.ly/plotly-2.27.0.min.js";

type PlotlySankeyProps = {
  data: any[];
  layout: Record<string, any>;
};

export default function PlotlySankey({ data, layout }: PlotlySankeyProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  const frozenData = useMemo(() => JSON.parse(JSON.stringify(data)) as any[], [data]);
  const frozenLayout = useMemo(
    () => JSON.parse(JSON.stringify(layout)) as Record<string, any>,
    [layout]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    async function ensurePlotly() {
      if (getPlotly()) {
        setReady(true);
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector(`script[src="${PLOTLY_CDN}"]`);
        if (existing) {
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () => reject(new Error("Plotly failed to load")));
          return;
        }

        const script = document.createElement("script");
        script.src = PLOTLY_CDN;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Plotly failed to load"));
        document.head.appendChild(script);
      });

      if (!cancelled && getPlotly()) {
        setReady(true);
      }
    }

    ensurePlotly().catch((err) => {
      console.error("Failed to load Plotly", err);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const target = containerRef.current;
    const PlotlyInstance = getPlotly();
    if (!target || !PlotlyInstance) return;

    PlotlyInstance.react(target, frozenData, frozenLayout, { responsive: true });

    return () => {
      PlotlyInstance.purge(target);
    };
  }, [ready, frozenData, frozenLayout]);

  return <div ref={containerRef} style={{ width: "100%", minHeight: 520 }} />;
}

declare global {
  interface Window {
    Plotly?: any;
  }
}

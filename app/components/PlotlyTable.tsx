// app/components/PlotlyTable.tsx
"use client";

import { useEffect, useRef } from "react";

export default function PlotlyTable({
  data,
  layout,
}: {
  data: any[];
  layout?: any;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let Plotly: any;
    
    const loadPlotly = async () => {
      Plotly = await import("plotly.js-dist-min");
      if (containerRef.current) {
        await Plotly.newPlot(
          containerRef.current,
          data,
          layout || {},
          {
            responsive: true,
            displayModeBar: false,
          }
        );
      }
    };

    loadPlotly();

    return () => {
      if (containerRef.current && Plotly) {
        Plotly.purge(containerRef.current);
      }
    };
  }, [data, layout]);

  return <div ref={containerRef} style={{ width: "100%" }} />;
}

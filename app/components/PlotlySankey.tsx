// app/components/PlotlySankey.tsx
"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

export type PlotlySankeyProps = {
  data: any[];
  layout?: any;
  className?: string;
  /** Optional height (px). If provided, we set both layout.height and container style height. */
  height?: number;
};

export default function PlotlySankey({ data, layout, className, height }: PlotlySankeyProps) {
  const finalLayout = useMemo(() => {
    const L = { ...(layout || {}) };
    if (height != null) L.height = height;
    // good defaults for responsiveness
    if (L.margin == null) L.margin = { l: 12, r: 12, t: 24, b: 12 };
    return L;
  }, [layout, height]);

  return (
    <Plot
      data={data}
      layout={finalLayout}
      className={className}
      style={{ width: "100%", ...(height != null ? { height } : {}) }}
      useResizeHandler
      config={{ displayModeBar: false, responsive: true }}
    />
  );
}

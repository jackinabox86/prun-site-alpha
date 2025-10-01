// app/components/PlotlyTable.tsx
"use client";

import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

export default function PlotlyTable({
  data,
  layout,
}: {
  data: any[];
  layout?: any;
}) {
  return (
    <Plot
      data={data}
      layout={layout || {}}
      config={{
        responsive: true,
        displayModeBar: false,
      }}
      style={{ width: "100%" }}
    />
  );
}

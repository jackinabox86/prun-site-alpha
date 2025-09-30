/* src/types/plotly-react.d.ts */

/* Minimal shims so TS is happy */
declare module "react-plotly.js" {
  import * as React from "react";
  const Plot: React.ComponentType<any>;
  export default Plot;
}

declare module "react-plotly.js/factory" {
  // If you ever switch to the factory variant
  const createPlotlyComponent: (plotly: any) => any;
  export default createPlotlyComponent;
}

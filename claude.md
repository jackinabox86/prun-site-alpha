Important: Do not commit without asking for approval.  Do not merge PRs without asking for approval.


# Production Profitability Optimizer

## Overview
This Next.js webapp evaluates buy/make scenarios for production chains to identify the most profitable configurations. It analyzes thousands of sourcing combinations across production recipes, ranking them by profit per unit area (Profit/Area or P/A).

## Core Concept
For any material (ticker), the system:
1. Explores all available production recipes
2. For each recipe input, evaluates BUY (market purchase) vs MAKE (in-house production) options
3. Recursively analyzes multi-tier production chains (up to 3 levels deep)
4. Ranks scenarios by profitability metrics (Profit/Area, ROI, input payback)

## Key Files

### Core Engine
- `src/core/engine.ts` - Main scenario generation engine
  - `findAllMakeOptions()` - Explores BUY/MAKE combinations for production chains
  - `buildScenarioRows()` - Calculates area, cost, and profit metrics for scenario trees
  - Intelligent pruning to manage combinatorial explosion (top N by P/A + diversity sampling)

### Data Models
- `src/types.ts` - Type definitions for recipes, prices, scenarios, and options
  - `MakeOption` - A complete production scenario with costs, profits, and child inputs
  - `ScenarioRowsResult` - Aggregated metrics (area, build cost, input buffer) for scenario tree

### Report Generation
- `src/server/report.ts` - Builds analysis reports with top 20 scenarios per ticker
  - Computes ROI (narrow: stage only, broad: entire production tree)
  - Calculates input buffer payback periods
  - Ranks by Profit/Area at full capacity

### Data Sources
- `src/lib/loadFromCsv.ts` - Loads recipes and market prices from CSV
- `src/server/cachedBestRecipes.ts` - Caches best scenario per ticker (hourly refresh)

### UI Components
- `app/components/ReportClient.tsx` - Main analysis interface (ticker selection, scenario viewer)
- `app/components/BestScenarioSankey.tsx` - Sankey diagram visualizing production flow
- `app/components/Top20Table.tsx` - Interactive table of top scenarios
- `app/best-recipes/BestRecipesClient.tsx` - Summary view of best scenarios across all tickers

## Key Metrics
- **Profit/Area (P/A)**: Profit per day divided by total area (self + normalized children) - primary ranking metric
- **ROI Narrow**: Payback period for stage build cost only (self.buildCost / self.baseProfitPerDay)
- **ROI Broad**: Payback period for entire production tree (subtree.buildCost / self.baseProfitPerDay)
- **Input Payback**: Days to recover 7-day input buffer costs from daily profit
- **COGM**: Cost of goods manufactured per unit output
- **Opportunity Cost**: Forgone profit from making inputs instead of buying them

## Architecture
- **Framework**: Next.js 15 (React 18, TypeScript)
- **Deployment**: Vercel (Node.js runtime)
- **Visualization**: Plotly.js (interactive charts, Sankey diagrams)
- **Data**: CSV files (recipes, prices) loaded from Vercel Blob storage

## Development
- `npm run dev` - Start development server (Turbopack enabled)
- `npm run build` - Production build
- Main page: recipe analysis UI
- `/best-recipes` route: cross-ticker best scenarios table

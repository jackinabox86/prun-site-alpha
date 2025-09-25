# Architecture Overview

## Current State (Google Sheets + Apps Script)
- **Data Sources**
  - Recipes (game production recipes)
  - Prices (market bid/ask prices)
  - BestRecipeIDs (precomputed “best” scenarios, refreshed hourly)
  - Control Panel (user selects ticker + toggles)

- **Logic**
  - Apps Script functions:
    - `refreshBestRecipeIDs`: precomputes and caches best recipe per ticker.
    - `generateReportFromSelection`: user-facing function to build a report for one ticker.
  - In-memory + persisted cache (`scenarioCache`) to avoid recomputation.
  - Recursive functions:
    - `findAllMakeOptions`: explores sourcing scenarios.
    - `buildScenarioRows`: expands a scenario into rows for display, with profit/area metrics.

- **Output**
  - Reports written to per-ticker report sheets.
  - BestRecipeIDs sheet updated hourly.

---

## Target State (Web App + API)
- **Backend**
  - Node.js/Next.js API routes on Vercel.
  - Core logic (scenarios, profit/area calculations) extracted from Apps Script → standalone modules.
  - Data source abstraction layer (initially still Google Sheets, later possibly database).

- **Frontend**
  - Next.js React pages for:
    - Control panel (ticker selection, bid/ask toggle).
    - Report viewer.
    - Visualization dashboards (Plotly, charts).

- **Data Flow**
  1. User selects ticker in web UI.
  2. API route calls scenario engine with ticker + settings.
  3. Scenario engine reads cached data or recomputes if needed.
  4. Result returned as JSON → rendered in UI with tables + plots.
  5. Hourly job (cron / scheduled function) refreshes best recipes.

---

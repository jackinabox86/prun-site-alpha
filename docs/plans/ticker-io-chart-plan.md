# Implementation Plan: Ticker Input/Output (IO) Chart

**Status:** Plan only — not implemented.
**Goal:** A new page where the user picks a ticker (plus exchange, pricing mode, extraction mode). The page shows:

1. A new **IO chart**: the ticker as a central node annotated with its main-analysis profit; its **input materials** on the left (materials consumed by recipes that *produce* the ticker) and its **consumer materials** on the right (materials whose recipes *consume* the ticker), each connected to the center by a line and annotated with that material's best profit (P/A) from the best-recipes dataset.
2. Below it, the **existing best-scenario Sankey** for the ticker (reusing `BestScenarioSankey`).

---

## 1. Research Summary (what exists today)

### 1.1 Recipes data model

`RecipeMap` (`src/types.ts` lines 42–45) is `{ headers: string[]; map: { [ticker]: RecipeRow[] } }`, built by `buildRecipeMap` in `src/core/maps.ts` from a sheet-shaped CSV (`[headers, ...rows]`). Loading goes through `loadAllFromCsv` (`src/lib/loadFromCsv.ts`), which fetches the recipes CSV, prices CSV, and (optionally) a best map.

The recipes CSV (`public/data/recipes-dynamic.csv` / `recipes-legacy.csv`, or GCS `GCS_RECIPES_URL`) has these columns (verified from the file header):

```
Building, Ticker, RecipeID, WfCst, Deprec, Area, AllBuildCst,
Output1CNT, Output1MAT, Output2CNT, Output2MAT, Output3CNT, Output3MAT,
Input1CNT, Input1MAT, ... Input10CNT, Input10MAT,
RecipP/D, Runs P/D, Output P/D, AreaPerOutput,
WfCst-ANT, Deprec-ANT, AllBuildCst-ANT, ... (per-exchange cost columns, incl. UNV7/UNV30)
```

Key facts:

- **One row = one recipe.** The `Ticker` column is the *primary output*; `recipeMap.map[ticker]` returns all recipes producing that ticker. A ticker can have many recipes (e.g., `RAT_1`..`RAT_12`, `C_1`..`C_6`).
- **Inputs of a recipe** are the up-to-ten `Input{j}MAT` / `Input{j}CNT` pairs (`j = 1..10`); empty cells are `null` after `coerce()`.
- **Consumers of a ticker X** are found by scanning *every* row of *every* ticker and checking whether any `Input{j}MAT === X`. The consuming material is the row's `Ticker` value. This exact scan pattern already exists in `buildDependencyGraph` (`src/server/bestRecipes.ts` lines 172–203) — reuse/copy it.
- Byproducts appear in `Output2MAT`/`Output3MAT`. A ticker can therefore also be produced as a byproduct of another ticker's recipe; v1 ignores byproduct edges (see edge cases, §7.8).
- **Extraction mode** (ANT only) merges `ANT-expandedrecipes-dynamic.csv` (extra `Planet` column that is spliced out) into the recipe map — done identically in `app/api/report/route.ts` → `src/server/report.ts` (lines 117–166) and `app/api/tickers/route.ts`. The new endpoint must replicate this so raw resources (FEO, H2O, …) gain producing recipes in extraction mode.

### 1.2 Main analysis invocation & "the profit result"

- `GET /api/report?ticker=&exchange=&priceType=&priceSource=&extractionMode=` (`app/api/report/route.ts`) → `buildReport()` (`src/server/report.ts`).
- Response shape (schemaVersion 3): `{ ticker, exchange, priceType, totalOptions, bestPA, bestScenario, best, top20, topDisplayScenarios, error? }`.
- `best` is a `MakeOption` enriched with `totalProfitPA`, `totalAreaPerDay`, ROI/payback fields, and `madeInputDetails` — the exact object `BestScenarioSankey` consumes (`ReportClient.tsx` line 1041: `<BestScenarioSankey best={report.best} exchange={report.exchange} priceType={report.priceType} />`).

**Recommended central-node metric: `report.bestPA`** (the best scenario's subtree **profit per area per day**).

*Justification:* (a) it is the headline metric of the whole site ("TICKER ANALYSIS // BEST PROFIT PER AREA", the big "Best P/A" stat in `ReportClient`); (b) the best-recipes dataset shown on the left/right nodes stores `profitPA` — the *same* metric — so center and neighbors are directly comparable (apples-to-apples), which is the entire point of this chart; (c) profit/day is chain-size dependent and would not be comparable across neighbors. Secondary line on the central node can show `best.baseProfitPerDay` ("Chain Profit/Day") as supplemental info.

### 1.3 Best-recipes data (client fetch & keying)

- Client pattern (from `app/best-recipes/BestRecipesClient.tsx`, `loadData()` lines 178–223): `GET /api/best-recipes?exchange={EX}&sellAt={bid|ask|pp7}[&extractionMode=true]`, response `{ success, data: BestRecipeResult[], ... }`.
- `BestRecipeResult` (`src/server/bestRecipes.ts` lines 9–18): `{ ticker, recipeId, scenario, profitPA, buyAllProfitPA, building?, top3DisplayScenarios?, volume? }`. **The field to display is `profitPA`** (number, currency/area/day).
- Server side (`src/server/cachedBestRecipes.ts` + `src/lib/config.ts`): cache key `${priceSource}-${exchange}-${sellAt}-${mode}`; resolves to file/URL `best-recipes-{EXCHANGE}-{sellAt}{-Extraction}.json` (GCS by default; the API route defaults `priceSource=gcs`). The repo-local `public/data/best-recipes-315.json` is a frozen legacy snapshot (a flat array of `BestRecipeResult` — confirmed 315 entries) used only for `local` mode; **per-exchange local variants don't exist locally, so the new page should use the default `gcs` source** like the rest of the UI.
- **Settings → dataset variant mapping** (mirrors existing code):
  - `exchange`: pass through (`ANT`/`CIS`/`ICA`/`NCC`); for `UNV` pass `UNV7` when `priceType=pp7`, `UNV30` when `priceType=pp30` (the API's `VALID_EXCHANGE_DISPLAYS` accepts these). Note `buildReport` itself maps UNV→ANT for its internal pruning map, but for *display* data we want the variant matching the user's sell mode.
  - `sellAt`: `priceType` if it is `bid`/`ask`/`pp7`; map `pp30 → pp7` (best-recipes only supports bid/ask/pp7 — `VALID_SELL_AT` in `app/api/best-recipes/route.ts`; pp7 is the nearest price-point basis). Show a small "displayed at PP7" hint in that case.
  - `extractionMode` → `extractionMode=true` query param (server maps it to the `-Extraction` file).

### 1.4 Settings UI pattern

`ReportClient.tsx` (lines 28–63) and `BestRecipesClient.tsx` (lines 146–160) both use `usePersistedSettings` (`src/hooks/usePersistedSettings.ts`) with **shared keys**, so settings follow the user across pages:

- `prun:settings:exchange` (urlParam `exchange`, default `ANT`)
- `prun:settings:priceType` (urlParam `priceType`, default `bid`)
- `prun:settings:extractionMode` (urlParam `extractionMode`, default `false`; UI disables it unless exchange is ANT)
- Ticker: plain state + `?ticker=` URL param read on mount; autocomplete list from `GET /api/tickers[?extractionMode=true]`.
- Exchange labels via `getExchangeDisplayName` (`src/lib/exchanges.ts`: CIS→"BEN", ICA→"HRT", NCC→"MOR"). Currency formatting via `formatCurrency`/`formatProfitPerArea` (`src/lib/formatting.ts`).

The new page reuses this pattern verbatim (same keys, same control layout: Ticker autocomplete / Exchange select / Extraction toggle / Sell At select / Execute button).

### 1.5 Chart components

- `PlotlySankey.tsx`: thin dynamic-import wrapper around `react-plotly.js`.
- `BestScenarioSankey.tsx`: memoized component, props `{ best, height?, exchange?, priceType? }` — fully reusable as-is for requirement 3.
- `AemSankey.tsx` exists as a second Plotly Sankey precedent.

---

## 2. Key Design Decisions

### D1 — Inputs across multiple recipes: **union, with a "best recipe only" filter toggle**

A ticker often has several recipes with different input sets (`AL_1: ALO,C,O` vs `AL_2: ALO,C,FLX,O`; `RAT` has 12 recipes spanning ~8 distinct inputs). Decision:

- **Default: union of `Input{j}MAT` across all rows in `recipeMap.map[ticker]`**, deduplicated, each input annotated with the recipe IDs that use it. Rationale: the chart's purpose is *market-structure* discovery ("what feeds this material / what does it feed"), so hiding inputs used only by alternate recipes would misrepresent the neighborhood; input sets stay small (≤ ~10 distinct materials) so union does not blow up the layout.
- **Toggle "Best recipe only"** (client-side filter, no refetch): keeps only inputs whose `recipeIds` include the best recipe chosen by the main analysis (`report.best.recipeId`). Cheap because the API returns per-recipe grouping (§3.2) and the report is already fetched. This gives the "what does my actual chain consume" view.
- Symmetrically, the **outputs side is always the union** of consumers across all their recipes (a consumer is listed once even if only one of its recipes uses the ticker), annotated with the consuming recipe IDs. No best-recipe filtering on the right side — the ticker's own best recipe doesn't constrain who buys it.

### D2 — Central profit metric: `report.bestPA` (profit/area/day)

See §1.2 justification. Neighbor nodes show `BestRecipeResult.profitPA` — same unit.

### D3 — Rendering: **plain HTML + SVG connector overlay (no Plotly)**

Options considered:

| Option | Verdict |
|---|---|
| Plotly scatter + shapes/annotations | Rejected: node labels with 2–3 styled lines (ticker, profit, badges) are painful as annotations; per-node click routing is awkward (`plotly_click` + point mapping); heavy bundle already loaded elsewhere but adds no value here; hover/format control fights the terminal theme. |
| Small Plotly Sankey | Rejected: Sankey semantics (weighted flows) don't fit — we have no meaningful flow quantity between neighbors and center (profit P/A is a node property, not an edge weight); Sankey also forces link thickness encoding that would mislead. |
| **HTML nodes + absolutely-positioned SVG `<path>` underlay** | **Chosen.** A hub-and-spoke tripartite layout is trivial in CSS grid/flex; nodes are ordinary styled `<div>`s (theme CSS vars, tooltips, `<a>`/router navigation for free); an `<svg>` behind them draws cubic-bezier connectors between measured anchor points (refs + `ResizeObserver`, recompute on resize/expand). Zero new dependencies, fully responsive, accessible, and node-click → navigate is a plain link. |

Node click behavior (nice-to-have, included in plan): clicking a left/right node re-runs the IO page for that ticker (`router.push("/ticker-io?ticker=X&...")`); a secondary small link/icon on each node opens the main analysis (`/?ticker=X&exchange=...&priceType=...&extractionMode=...`).

### D4 — Placement & API strategy: **new route `app/ticker-io/`, one new API endpoint, two reused endpoints**

- New page rather than extending `ReportClient` (already 1074 lines; different mental model; keeps `/` stable). Follows the established `page.tsx` + `*Client.tsx` pattern (`app/best-recipes/`).
- **Reuse** `GET /api/report` (central profit + Sankey `best` object) and `GET /api/best-recipes` (neighbor profits) unchanged.
- **One new endpoint** `GET /api/ticker-io` for the inputs/consumers sets. Rationale for server-side derivation: the recipes CSV lives behind `GCS_DATA_SOURCES` env config with server-side CSV caching (`fetchCsv`), and the extraction-mode merge logic (Planet-column splice) is server code already duplicated in two routes — a third client-side reimplementation would be worse. The consumer scan is O(rows×10) over ~400 rows — negligible.

---

## 3. Architecture & Data Flow

```
                       app/ticker-io/page.tsx  (server shell, force-dynamic)
                                  │
                       TickerIOClient.tsx ("use client")
                          │  settings: usePersistedSettings
                          │  (prun:settings:exchange / priceType / extractionMode)
                          │  ticker input + /api/tickers autocomplete
                          │
        Execute → 3 parallel fetches (Promise.all-ish, independent states)
        ┌─────────────────────────┼───────────────────────────────┐
        ▼                         ▼                               ▼
GET /api/report            GET /api/ticker-io             GET /api/best-recipes
 ?ticker&exchange           ?ticker&extractionMode          ?exchange&sellAt
 &priceType&extractionMode  &priceSource                    &extractionMode
        │                         │                               │
 buildReport()             getTickerIO()  [NEW]           cachedBestRecipes
 (src/server/report.ts)    (src/server/tickerIO.ts)       (existing, GCS JSON:
        │                   loadAllFromCsv + extraction    best-recipes-{EX}-{sellAt}
        │                   merge + input/consumer scan     [-Extraction].json)
        ▼                         ▼                               ▼
   { bestPA, best, ... }   { inputs[], outputs[] }     Map<ticker, profitPA>
        └───────────────┬─────────┴───────────────┬───────────────┘
                        ▼      client-side join   ▼
              ┌──────────────────────────────────────────┐
              │ TickerIOChart.tsx  [NEW]                 │
              │  left: inputs (+profitPA)  ← SVG lines → │
              │  center: ticker (+bestPA)                │
              │  right: consumers (+profitPA)            │
              └──────────────────────────────────────────┘
              ┌──────────────────────────────────────────┐
              │ BestScenarioSankey (REUSED)              │
              │  best={report.best} exchange priceType   │
              └──────────────────────────────────────────┘
```

### 3.1 New endpoint: `GET /api/ticker-io`

Query params: `ticker` (required), `extractionMode` (`"true"`/absent), `priceSource` (`gcs` default, mirroring `/api/tickers`).

Response:

```jsonc
{
  "ok": true,
  "ticker": "AL",
  "producingRecipes": [            // every row in recipeMap.map[ticker]
    { "recipeId": "AL_1", "building": "SME",
      "inputs": [ { "ticker": "ALO", "count": 6 }, { "ticker": "C", "count": 1 }, { "ticker": "O", "count": 1 } ],
      "outputs": [ { "ticker": "AL", "count": 3 } ] }
  ],
  "inputs": [                      // union across producingRecipes, deduped by ticker
    { "ticker": "ALO", "recipeIds": ["AL_1","AL_2"], "maxCount": 6 }
  ],
  "outputs": [                     // consumers: rows anywhere with Input{j}MAT === "AL"
    { "ticker": "BBH", "recipeIds": ["BBH_2"], "building": "PP2", "countUsed": 2 }
  ]
}
```

### 3.2 Derivation logic (exact field names)

In new `src/server/tickerIO.ts`:

```ts
// Load exactly like app/api/tickers/route.ts:
//   const { bestMap } = await cachedBestRecipes.getBestRecipes(priceSource, "ANT", "bid");
//   const { recipeMap } = await loadAllFromCsv({ recipes, prices }, { bestMap });
//   if (extractionMode): load GCS_STATIC_BASE + "/ANT-expandedrecipes-dynamic.csv",
//     splice out headers.indexOf("Planet") from headers and every row (CLONE first —
//     copy the deep-clone guard from src/server/report.ts lines 105–113; the CSV cache
//     returns shared references), then merge rows into a cloned recipeMap.

const h = recipeMap.headers;
const iTicker   = h.indexOf("Ticker");
const iRecipeId = h.indexOf("RecipeID");
const iBuilding = h.indexOf("Building");
const inCols  = [...Array(10)].map((_, j) => ({ mat: h.indexOf(`Input${j+1}MAT`),  cnt: h.indexOf(`Input${j+1}CNT`) }));
const outCols = [...Array(3)].map((_, j) => ({ mat: h.indexOf(`Output${j+1}MAT`), cnt: h.indexOf(`Output${j+1}CNT`) }));

// (a) INPUTS — union across all recipes that produce `ticker`
const inputsByTicker = new Map<string, { recipeIds: string[]; maxCount: number }>();
for (const row of recipeMap.map[ticker] ?? []) {
  const recipeId = String(row[iRecipeId] ?? "");
  for (const { mat, cnt } of inCols) {
    if (mat !== -1 && row[mat]) {
      const t = String(row[mat]);
      const n = Number(row[cnt] ?? 0);
      const e = inputsByTicker.get(t) ?? { recipeIds: [], maxCount: 0 };
      e.recipeIds.push(recipeId);
      e.maxCount = Math.max(e.maxCount, n);
      inputsByTicker.set(t, e);
    }
  }
}

// (b) OUTPUTS/CONSUMERS — scan every row of every ticker (cf. buildDependencyGraph,
// src/server/bestRecipes.ts lines 181–199, which does the same Input{j}MAT walk)
const consumersByTicker = new Map<string, { recipeIds: string[]; building: string | null; countUsed: number }>();
for (const [outTicker, rows] of Object.entries(recipeMap.map)) {
  if (outTicker === ticker) continue;               // guard self-loops
  for (const row of rows) {
    for (const { mat, cnt } of inCols) {
      if (mat !== -1 && String(row[mat] ?? "") === ticker) {
        // record consumer keyed by outTicker (the row's primary output = its `Ticker` column)
        ...
      }
    }
  }
}
```

Both maps are returned sorted alphabetically; the client re-sorts by profit (§4).

### 3.3 Client-side join

```ts
const profitByTicker = new Map(bestRecipesData.map(r => [r.ticker, r.profitPA]));
// node.profitPA = profitByTicker.get(node.ticker) ?? null   (null → "N/A" badge)
```

---

## 4. Files to Create / Modify

### Create

| File | Responsibility |
|---|---|
| `src/server/tickerIO.ts` | `getTickerIO({ ticker, extractionMode, priceSource })`: load recipeMap (with extraction merge + deep-clone guard), compute `producingRecipes`, `inputs` (union), `outputs` (consumer scan) per §3.2. Pure data, no pricing. |
| `app/api/ticker-io/route.ts` | Thin GET handler (mirror `app/api/report/route.ts` boilerplate: `runtime="nodejs"`, `dynamic="force-dynamic"`, no-store headers, `{ ok:false, error }` on throw, uppercase ticker). |
| `app/ticker-io/page.tsx` | Server shell, same 4 lines of exports as `app/best-recipes/page.tsx`; renders `TickerIOClient`. |
| `app/ticker-io/TickerIOClient.tsx` | Page brain: settings via `usePersistedSettings` (shared keys, §1.4); ticker autocomplete (copy the input+dropdown block from `ReportClient.tsx` lines 383–444, or extract it — see "optional refactor" below); Execute triggers the 3 fetches with independent loading/error state; joins best-recipes profits into IO nodes; "Best recipe only" toggle (D1); Share-link button (copy `handleShareClick` pattern); renders `TickerIOChart` then `BestScenarioSankey` (`best={report.best}`). |
| `app/components/TickerIOChart.tsx` | Presentational chart. Props: `{ centerTicker, centerProfitPA, centerProfitPerDay?, inputs: IONode[], outputs: IONode[], exchange, onNavigate(ticker) }` where `IONode = { ticker, profitPA: number | null, recipeIds: string[], missingFromBestRecipes: boolean }`. Layout: CSS grid `[left | center | right]`; each side a vertical stack of node cards; SVG absolutely positioned behind (`position:absolute; inset:0; pointer-events:none`) drawing cubic beziers from each side card's inner edge to the center card, anchor points measured via refs + `ResizeObserver`/`useLayoutEffect`. Node card: ticker (mono, accent), `formatProfitPerArea(profitPA)` colored green/red by sign, grey "N/A" when null, small recipe-id badge count, whole card clickable. Center card: big ticker, `Best P/A: {formatCurrency(bestPA, exchange)}`, secondary `Chain P/D`. Caps per §7.4. |

### Modify

| File | Change |
|---|---|
| `app/layout.tsx` | Add nav link: `<a href="/ticker-io">Ticker I/O</a>` (line ~18, next to existing links). |
| *(optional, recommended)* `app/components/ReportClient.tsx` | Extract the ticker autocomplete block into a shared `app/components/TickerAutocomplete.tsx` and consume it in both clients. If skipped, duplicate the ~60-line block into `TickerIOClient` (acceptable; note it as debt). |

No changes to `BestScenarioSankey`, `PlotlySankey`, `buildReport`, `cachedBestRecipes`, or types (new response types live in `src/server/tickerIO.ts` and are re-declared client-side, matching the repo's existing convention of per-client `type ApiReport = {...}`).

---

## 5. State & Settings Handling

- `exchange`, `priceType`, `extractionMode`: `usePersistedSettings` with the **same keys and urlParamNames as `ReportClient`** (§1.4) so the three pages stay in sync and deep links work (`/ticker-io?ticker=AL&exchange=CIS&priceType=bid`).
- `ticker`: local state, initialized from `?ticker=` on mount (copy `ReportClient` lines 89–129 pattern, minus force-params); autocomplete list from `/api/tickers?extractionMode=...` (re-fetched when extractionMode changes — existing effect pattern).
- Extraction toggle disabled unless `exchange === "ANT"` (same guard/tooltip as `ReportClient` lines 471–487). If exchange changes away from ANT while extractionMode is on, treat as off when building query params (same as report route behavior — server ignores it for non-ANT).
- `bestRecipeOnly` (D1 toggle): plain `useState`, default `false`, client-side filter only.
- Fetch params derived per §1.3: `sellAt = priceType === "pp30" ? "pp7" : priceType`; `bestRecipesExchange = exchange === "UNV" ? (priceType === "pp30" ? "UNV30" : "UNV7") : exchange`.
- Results kept in three independent state slots (`report`, `io`, `bestRecipesMap`) with per-fetch error strings, so a report failure doesn't blank the IO chart (§7.6).

## 6. Loading / Error States

- **Loading:** Execute disables the button ("Processing" with the existing `terminal-loading` class); chart area shows a skeleton box per section ("LOADING IO GRAPH…", "LOADING SANKEY…"). Best-recipes fetch can be slow on cold cache (server may compute) — reuse the `AbortController` + 5-min timeout pattern from `BestRecipesClient.loadData()`.
- **Errors (per-source, non-fatal to siblings):**
  - `/api/ticker-io` fails or ticker unknown → red terminal-box error; nothing else renders (chart is the page's point).
  - `/api/report` fails (e.g., "No price data for ticker X on UNV/bid") → IO chart still renders; central node shows "P/A: n/a" with a warning line carrying the report error; Sankey section shows the error box instead of the chart (mirrors `ReportClient` error boxes, lines 815–829).
  - `/api/best-recipes` fails → IO chart renders with all neighbor profits as "N/A" plus a dismissible warning banner.
- Empty ticker / no Execute yet → placeholder box ("Enter a ticker and Execute").

## 7. Edge Cases

1. **Raw materials with no producing recipes** (e.g., FEO/H2O in standard mode — absent from `recipeMap.map` keys or present only via extraction file): `inputs` is empty → left column renders a single muted placeholder card "RAW MATERIAL — no producing recipes"; no lines drawn. (In extraction mode + ANT these gain extraction recipes whose inputs may be empty anyway — same rendering handles it.)
2. **Terminal goods with no consumers** (nothing lists them as an input): right column placeholder "NO CONSUMERS — end product".
3. **Ticker itself missing from recipe data entirely** → `/api/ticker-io` returns `ok:false, error:"Unknown ticker"` (validate `recipeMap.map[ticker] || consumers found`, and cross-check the `/api/tickers` list client-side before fetching).
4. **Many inputs/outputs:** inputs are bounded (≤ ~10 distinct), but consumers can be large (H2O/AL/PE feed dozens of recipes). Layout rule: sort each side **descending by `profitPA`** (nulls last, alphabetical tiebreak); render at most **N = 12** cards per side with connectors; remaining collapse into a final "+K more" card (no connector) that expands the column into a scrollable list *without* SVG lines (lines to scrolled/hidden elements are omitted rather than mis-anchored — recompute visible anchors on toggle via ResizeObserver).
5. **Ticker present in recipes but missing from best-recipes data** (best-recipes covers ~315 produced tickers; buy-only inputs like ores in standard mode have no entry): show grey "N/A" and a tooltip "not in best-recipes dataset"; keep the node and line.
6. **Report has no scenario** (`best: null` / error, e.g., unprofitable or UNV+bid): render IO chart anyway (see §6); when `exchange === "UNV"` and `priceType` is bid/ask, surface the server's "Must sell at pp7 or pp30" error verbatim.
7. **pp30 pricing:** best-recipes has no pp30 variant → map to pp7 and show "(neighbor profits @ PP7)" hint (§1.3).
8. **Byproduct relationships:** a ticker produced as `Output2MAT`/`Output3MAT` of someone else's recipe, or byproducts of this ticker's recipes, are *not* IO edges in v1; document in the page readme. (Future: dashed lines.)
9. **Self-loops / duplicates:** skip rows where consumer ticker === selected ticker; a material appearing on both sides (mutual chains) is legitimate — render on both sides independently.
10. **Extraction-mode cache pollution:** never mutate `loadAllFromCsv` results — copy the deep-clone-before-splice guard from `report.ts` (lines 103–113 / 128–154); this is a known footgun in this codebase.
11. **Node count = 0 on both sides** (isolated ticker): show both placeholders; still show central node + Sankey.

## 8. Step-by-Step Implementation Sequence

| # | Step | Details | Est. |
|---|---|---|---|
| 1 | `src/server/tickerIO.ts` | Load + extraction merge (copy from `tickers/route.ts`/`report.ts` with clone guard), input union + consumer scan (§3.2), types. | 2–3 h |
| 2 | `app/api/ticker-io/route.ts` | Param parsing, validation, no-store headers, error envelope. Manual test: `curl "localhost:3000/api/ticker-io?ticker=AL"`, spot-check AL (inputs ALO/C/O/FLX; consumers incl. BBH, BSE, BTA, SI_1, EXO…), RAT (12 recipes → union), FEO standard vs extraction, terminal good (e.g., CC). | 1–1.5 h |
| 3 | Page scaffold | `app/ticker-io/page.tsx`, `TickerIOClient.tsx` skeleton: settings controls (copy ReportClient control grid minus force-fields), ticker autocomplete (extract `TickerAutocomplete.tsx` or duplicate), Execute wiring, URL/share handling. | 2–3 h |
| 4 | Data layer | Three fetches with independent state, best-recipes param mapping (UNV7/30, pp30→pp7), profit join, `bestRecipeOnly` filter. | 1–1.5 h |
| 5 | `TickerIOChart.tsx` | Grid layout, node cards, center card with `bestPA`, SVG bezier overlay with ref-measured anchors + ResizeObserver, sort/cap/"+K more", click-to-navigate (`router.push`) + main-analysis link per node. | 3–4 h |
| 6 | Sankey reuse + polish | Mount `BestScenarioSankey best={report.best}` below chart; loading skeletons, per-source error boxes, placeholders (§6–7), readme blurb box, nav link in `layout.tsx`. | 1–1.5 h |
| 7 | Verification pass | `npm run build` + typecheck; drive the page for: AL (rich both sides), H2O (huge consumer list → cap), FEO ±extraction, CC (no consumers), UNV+pp7, CIS exchange, ticker with no best-recipes entry; confirm settings persist across `/`, `/best-recipes`, `/ticker-io`. | 1–2 h |

**Total: roughly 11–16 hours.** No schema, dependency, or infra changes; the only new server surface is the read-only `/api/ticker-io` endpoint.

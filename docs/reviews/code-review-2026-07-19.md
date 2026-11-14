# Code Review — 2026-07-19

Multi-agent review of the repository. Part 1 covers the application layer (`app/` API routes, React clients, workflows, configs); Part 2 covers the core engine and server layer (`src/core`, `src/server`, `src/lib`).

---

# Part 1: Core Engine & Server Layer (`src/core`, `src/server`, `src/lib`)

## Critical

### C1. Child-stage `runsPerDay` is clamped to a minimum of 1, root stage is not — inflates throughput of slow recipes by up to 25%+
- **Files:** `src/core/engine.ts:306, 645` vs `engine.ts:1041`
- `bestOptionForTicker` and `buildAllOptionsForTicker` compute `runsPerDay = Math.max(1, Number(row[idx.runs] ?? 0) || 1)`, while the root path in `findAllMakeOptions` correctly preserves fractional values (`runsPerDayVal > 0 ? runsPerDayVal : 1`). **46 of 370 recipes in `public/data/recipes-dynamic.csv` have `Runs P/D` < 1** (e.g. 0.8), so whenever such a recipe appears as a child/grandchild, its `runsPerDay` becomes 1.
- **Failure scenario:** a child recipe with true 0.8 runs/day gets `baseProfitPerDay`, `profitPerDay`, daily capacity, `inputBuffer7`, and the P/A used to *select* the best child scenario all inflated ~25%. The same recipe analyzed as the root ticker uses 0.8. Result: mis-ranked make-vs-buy decisions, understated ROI days, and a ticker's numbers change depending on whether it's the root or a child. (`calculateBuyAllProfitPA` in `bestRecipes.ts:107` also uses the unclamped value, further inconsistent with the clamped engine paths.)

### C2. Module-level scenario memos are keyed without request-scoped context — concurrent requests cross-contaminate
- **Files:** `src/core/engine.ts:43-69, 566-567, 890, 921-923, 1294-1297`; `src/server/report.ts:41`
- `BEST_MEMO`/`ALL_SCENARIOS_MEMO` keys include exchange/priceType/ticker/force-sets, but **not** `priceSource`, `extractionMode` (merged expanded recipes), `forceBidPrice`/`forceAskPrice` overrides, `honorRecipeIdFilter`, or the `bestMap` identity. `buildReport` compensates with `clearScenarioCache()` at request start — but that only works for serialized requests.
- **Failure scenario:** Request A (`extractionMode=true`, or with `forceAskPrice=H2O:1`) and request B (plain) overlap. Both call `clearScenarioCache()` and then `await` CSV/best-recipe loads. A's synchronous `findAllMakeOptions` runs and populates the memo with extraction-recipe/overridden-price results; B (which cleared the cache *before* A computed) then computes and reuses A's memo entries under identical keys → B's report silently contains A's overridden economics. Next.js route handlers run concurrently in one process, so this interleaving is realistic under any parallel traffic.

## Major

### M1. A failed best-recipes load permanently poisons that cache key
- **File:** `src/server/cachedBestRecipes.ts:57-63`
- `getBestRecipes` does `this.initPromises.set(key, p); await p; this.initPromises.delete(key)`. If `initialize` rejects (one transient GCS 500/timeout), the `delete` never runs. Every subsequent call finds the stale rejected promise at line 49-54 and rethrows instantly — no retry ever happens until process restart or a manual `clearCache()` call. One GCS blip → that exchange/mode is down for the container's lifetime.

### M2. CSV cache never invalidates — "live GCS" prices are frozen at first fetch
- **File:** `src/lib/csvFetch.ts:6, 47-48, 71`
- `csvCache` has no TTL and no clear function anywhere in the codebase (verified by grep). The fetch uses `cache: 'no-store'` and the report route sends aggressive no-cache headers, but the in-memory row cache keeps the first-ever download forever. On any long-lived server (or a warm serverless container), price/recipe updates in GCS are never picked up despite `claude.md` describing hourly refresh. The `no-store` fetch + permanent memo is self-contradictory.

### M3. Cycle-truncated results are memoized under a cycle-independent key
- **File:** `src/core/engine.ts:566-571, 890`
- `bestOptionForTicker` checks/sets `BEST_MEMO` with a key that ignores the `seen` set, but the computed result depends on `seen` (cycle guard returns `null` for revisited tickers, silently dropping MAKE branches).
- **Failure scenario:** tickers A↔B form a cycle. Evaluating A first calls `bestOptionForTicker(B, seen={A})`, which computes B *without* its "Make A" branch and memoizes it. A later direct evaluation of B (empty `seen`) gets the truncated cached result even though "Make A" may be B's best scenario. Within a single report this happens whenever a cyclic pair appears in the tree.

### M4. `top3DisplayScenarios` diversity feature is dead in serving — `convertToEnhancedBestMap` is never called
- **Files:** `src/server/bestRecipes.ts:35-59`; `src/server/cachedBestRecipes.ts:86, 106`
- The generated JSON contains `top3DisplayScenarios`, and the engine has a whole code path keyed on it (`engine.ts:182-220, 926-943`), but `cachedBestRecipes.initialize` builds the bestMap with `convertToBestMap`, which drops the field. So in `buildReport`, deep children (depth ≥ 4) always fall back to single-best; the diversity path only ever runs inside `refreshBestRecipeIDs` (which builds its own enhanced map). Either an oversight (should use `convertToEnhancedBestMap`) or ~120 lines of dead engine code plus an unused export.

### M5. `computeDepth` has no cycle guard — stack overflow on cyclic recipe data
- **File:** `src/server/bestRecipes.ts:209-223`
- Memoization is only written *after* full recursion; there is no in-progress marker. A recipe cycle (A needs B, B needs A — the engine elsewhere explicitly guards against exactly this) causes infinite recursion. `getTickersInDependencyOrder` is called *outside* the per-ticker try/catch (line 290), so the whole `refreshBestRecipeIDs` run crashes with `RangeError: Maximum call stack size exceeded`.

### M6. Missing exchange cost columns are silently read as 0 — and the default `priceSource="local"` path is broken
- **Files:** `src/core/engine.ts:244-253, 310-313, 578-587, 650-653`; `src/lib/config.ts:10-13`; `src/server/report.ts:37`
- The engine looks up `WfCst-${exchange}`, `Deprec-${exchange}`, `AllBuildCst-${exchange}`. `public/data/recipes-legacy.csv` (the `LOCAL_DATA_SOURCES` file) only has unsuffixed `WfCst/Deprec/AllBuildCst`, so `indexOf` returns −1 and `Number(row[-1] ?? 0) || 0` silently yields **zero workforce, depreciation, and build cost for every recipe** — profits wildly overstated with no warning. `buildReport` defaults to `priceSource="local"` (as does the API route), where today the missing `public/data/best-recipes-ANT-bid.json` at least makes it fail loudly first; but `refreshBestRecipeIDs("local")` and anything re-adding that file will produce silently garbage numbers. A header-existence assertion (like `buildRecipeMap`'s Ticker check) is needed.

### M7. `ALL_SCENARIOS_MEMO` key omits `depth`, but cached contents are depth-dependent
- **File:** `src/core/engine.ts:921-923, 1075-1098, 1294-1297`
- Results generated at depth 1 (children explored, `pruneForDiversity` applied at `depth === 1`) differ from those generated at depth 3 (children resolved to single-best, no diversity pruning), yet both cache under the same key. Whichever depth reaches a ticker first wins, and later calls at other depths get scenario sets with the wrong granularity — so the option set for a ticker depends on graph traversal order, not on the design's per-depth pruning rules.

## Minor

1. **Shared-object mutation from `buildScenarioRows`** (`engine.ts:1357-1358, 1399`): it writes `item.childRunsPerDayRequired`/`childDemandUnitsPerDay` and `(option as any).totalProfitPA` onto objects shared through the memo caches across many parent scenarios; last caller wins. Currently mostly benign (child P/A is capacity-based and idempotent), but it is exactly the hazard the unused `shallowClone` helper (`engine.ts:82-90`, dead code) was written to prevent — `BEST_MEMO.get()` returns the raw cached object.
2. **Silent scenario wipe-out** (`engine.ts:401-470, 741-812, 1159-1231`): if an input has no buy price and no makeable child (or `forceMake` names a raw material), `branched` is empty and `scenarios = []` — the entire recipe silently produces zero options with no diagnostic; the report then claims "No profitable production scenarios found", which is misleading (it wasn't a profitability failure).
3. **`clearCache` misses `pp30`** (`cachedBestRecipes.ts:220`): `sellAtOptions = ["bid","ask","pp7"]` — targeted clears leave `pp30` (UNV mode) entries stale.
4. **Sankey node ID collisions** (`aemChainBuilder.ts:120`): `id = ticker::depth::visited.size` collides for the same ticker at the same depth in sibling branches (e.g., root → A→C and root → B→C both yield `C::2::2`), which can merge/confuse Sankey nodes.
5. **Expanded-recipe merge assumes identical column order** (`report.ts:140-162`): after removing "Planet", expanded rows are appended into the standard map with no check that the remaining headers match `clonedRecipeMap.headers` in order — a column-order drift between the two generated CSVs would silently misalign every field.
6. **Misleading comments + wasted work in `report.ts:103-113`**: `loadAllFromCsv` rebuilds `recipeMap`/`pricesMap` fresh on every call (only raw rows are cached in `csvFetch`), so the "csvCache returns the same object reference" comments are wrong and the deep clones are unnecessary — while the real per-request cost is re-coercing and re-building the full maps on every report (a genuine perf item; consider caching the built maps instead).
7. **Dead code / unused symbols**: `ip` at `report.ts:426` (computed, never used); `toNum` in `loadFromCsv.ts:103`; `refreshBestRecipeIDs` import in `cachedBestRecipes.ts:2`; `CSV_URLS` import in `bestRecipes.ts:6`; `findPriceLegacy` (`price.ts:20`); `urlParamsChecked` state in `usePersistedSettings.ts:69`; `getFileSuffix()` always returns `""` (`config.ts:32`). Also `refreshBestRecipeIDs`'s `buyPriceType` param only affects `calculateBuyAllProfitPA` — the engine always buys at `ask` — the docstring implies otherwise.
8. **`usePersistedSettings` type escape** (`usePersistedSettings.ts:20-25`): `defaultDeserialize` returns `str as T`, so a numeric setting read from a URL param would be a string typed as `number` (latent — only booleans are used today); visiting a shared URL also permanently overwrites the user's localStorage setting (line 81).
9. **`calculateBuyAllProfitPA` returns `0` for no rows** (`bestRecipes.ts:92`) though its contract/docs say `null`; and `if (outPrice)` / `output1HasPrice = !!outPrice` throughout treats a price of `0` as absent (consistent with `toPrice`, but worth documenting).
10. **API error contract mismatch** (adjacent: `app/api/report/route.ts:32`): the route checks `(report as any)?.ok === false`, but `buildReport` never sets `ok` — all in-band error payloads return HTTP 200.

## Performance notes

- **Repeated full-subtree recomputation:** `buildScenarioRows` (a full tree recursion) is called once per generated option in `buildAllOptionsForTicker` (engine.ts:531-533), again per option inside `pruneForDiversity` (line 104), and again per option in the report ranking (`report.ts:413`) — O(options × tree size), with `headers.indexOf(\`Input${j+1}MAT\`)` linear scans repeated per row per pass (engine.ts:323-324 etc.). Caching column indices once per (headers, exchange, priceType) would remove a large constant factor.
- **Combinatorial exposure at depth 2-3:** `pruneForDiversity` only runs at depths 0-1; depth-2/3 nodes rely solely on `pruneByInputCostShare`, which leaves *all* scenarios for any input with >30% cost share. A depth-2 recipe with 2-3 comparable-cost inputs multiplies its children's un-diversity-pruned scenario counts (each branch also copy-spreads `madeInputDetails`), and the unpruned arrays are then retained forever in `ALL_SCENARIOS_MEMO`. Bounded in practice by real data, but this is the memory/CPU blow-up point if recipes get deeper.
- **Response size:** `top20`/`topDisplayScenarios` each embed full recursive `madeInputDetails → details → madeInputDetails...` trees; with 20+20 entries × 4-level trees the JSON payload can reach megabytes.

---

# Part 2: Application Layer (`app/`, workflows, configs)

## Critical

### 1. `/api/snapshot` is an unauthenticated full source-code disclosure endpoint
`app/api/snapshot/route.ts:53-92` — Any visitor can GET `/api/snapshot` and receive the **complete contents of every `.ts/.tsx/.js/.json/.md/.yml` file** in `app/`, `src/`, and `docs/` (`content: buf.toString("utf8")`, line 76). There is no auth, no middleware, no token check anywhere in the repo. Failure scenario: anyone who discovers the route (it's guessable, and the route list is itself in the dump) downloads the whole codebase, internal docs/plans, and anything sensitive that ever lands in those folders (an `.env`-like JSON, a config with a key). This is a dev-only debugging tool that must be deleted or gated before production.

## Major

### 2. Best Recipes page shows stale data labeled with the newly selected exchange
`app/best-recipes/BestRecipesClient.tsx` — `loadData()` is only invoked from the "Generate Best Recipes" button (line 485); nothing refetches when `exchange`, `sellAt`, or `extractionMode` change. But the header (line 349: `BEST RECIPE DATABASE // {exchange}`) and the currency formatting (lines 690, 697: `formatProfitPerArea(row.profitPA, exchange)`) immediately use the new selection. Failure scenario: user loads ANT data, clicks "CIS" — the table still contains ANT numbers but is titled CIS and rendered with the CIS currency symbol. Genuinely misleading financial data.

### 3. Out-of-order fetch races in effect-driven loaders (no abort / request-id guard)
- `app/best-recipes-history/BestRecipesHistoryClient.tsx:107-178` — `loadMovers` re-fires via `useEffect` on every `period`/`exchange`/`sellAt` change with no `AbortController`. Rapid toggling 1d → 7d → 30d can let the 7d response resolve last and populate a table labeled 30d. Same for `loadHistory`.
- `app/pmmg/PMMGClient.tsx:104-137` — same pattern when switching months quickly.
- `app/components/ReportClient.tsx:75-86` — the tickers fetch keyed on `extractionMode` has no cancellation; a fast double-toggle can leave the wrong ticker list.

### 4. Unauthenticated fan-out endpoints fetch the entire GCS manifest per request
`app/api/historical-analysis/route.ts:169-236`, `app/api/historical-analysis/fio-summary/route.ts:121-195`, `app/api/historical-analysis/leaderboard/route.ts:130-191` — each request downloads *every* file in the manifest (batches of 50, all `cache: "no-store"`), with `maxDuration = 300` and zero server-side caching (unlike best-recipes, which uses `apiCache`). Failure scenario: a handful of concurrent visitors (or a bot hammering "Analyze Universe") triggers thousands of outbound GCS fetches each, saturating the serverless function and running up egress costs — a cheap DoS amplifier. At minimum these need the same 5-minute cache the best-recipes routes have.

### 5. Inflation index math silently breaks when a ticker has no base price on the index date
`app/api/inflation/route.ts:141-190` — the base price requires an *exact* `DateEpochMs === indexTimestamp` match (line 143). If the chosen index date has no data point for a ticker (gap, or timestamps not exactly UTC midnight), that ticker gets no `basePrices` entry and is skipped in every date's contribution (line 169) — but the weights are **not renormalized** (equal weight is `1/N` over all tickers, line 98). Failure scenario: 10-ticker equal-weight basket, one ticker missing on the index date → the index starts at ~90 instead of 100 and every plotted value is biased low, with no error surfaced. Also: the ticker list is unbounded (line 225) — `?tickers=` with 500 entries triggers 500 parallel outbound GCS fetches per request.

### 6. PMMG endpoints depend on unauthenticated GitHub API calls per request
`app/api/pmmg/route.ts:84-97`, `app/api/pmmg-mms/route.ts:71-74`, `app/api/pmmg-gdp/route.ts:63-66` — every page view hits `api.github.com/.../contents` with no token and `cache: "no-store"`. Unauthenticated GitHub API quota is 60 req/hour per IP; a serverless egress IP (often shared) will exhaust this quickly. Failure scenario: after ~20 page loads across the three PMMG pages in an hour, all of them start returning 502 "Could not retrieve available months" until the quota resets. Use a token or cache the listing.

## Minor

### 7. `/api/report` casts query params to typed unions without validation
`app/api/report/route.ts:16-18` — `exchange`, `priceType`, `priceSource` are cast with `as` from raw strings. `?exchange=JUNK` flows into `buildReport` and, at best, yields a confusing 500; the other routes (best-recipes, movers, history) validate against allowlists — this one should too.

### 8. Extraction mode leaks to non-ANT exchanges on the main page
`app/components/ReportClient.tsx:142-152` — `run()` always sends the persisted `extractionMode` flag even when `exchange !== "ANT"`. The toggle button is disabled for non-ANT (line 473) but never reset, so a user who enabled extraction on ANT then switches to CIS submits `exchange=CIS&extractionMode=true` — a combination the UI says is unsupported.

### 9. Dead "Make before Buy" sort in the Sankey layout
`app/components/BestScenarioSankey.tsx:348` — `isBuyNode` tests `nodeLabels[idx].startsWith("Buy ")`, but buy labels are built as `` `<b>&nbsp;Buy ${ticker}</b>` `` (line 219). The predicate is always false, so sort priority 2 (lines 370-372) never fires and the intended make/buy grouping within a column silently doesn't happen.

### 10. Expanded-row state keyed by row index survives report changes
`app/components/Top20Table.tsx:28` / `CondensedOptionsTable.tsx:28` — `expandedRows: Set<number>` isn't reset when `options` changes. Run a report for CBS, expand row 3, run a report for RAT → row 3 of the *new* table is pre-expanded showing a Sankey for an unrelated scenario.

### 11. `/api/best-recipes/history` treats invalid dates as "no data"
`app/api/best-recipes/history/route.ts:109-118` — `new Date("garbage").getTime()` is `NaN`; both `>= NaN` and `<= NaN` are false, so `?from=garbage` filters out every snapshot and returns a misleading 404 ("No historical data found") instead of a 400.

### 12. UNV7/UNV30 accepted by history/movers but can never resolve
`app/api/best-recipes/history/route.ts:15,83` and `movers/route.ts:14,119` — `exchange=UNV7` produces `configName = "best-recipes-UNV7-bid"`, but the workflow (`refresh-best-recipes-gcs.yml:121-167`) uploads snapshots under `historical/best-recipes-UNV7/` (no sellAt suffix). Those parameters always 404. (The UI doesn't expose them today, so it's latent.)

### 13. Movers fabricates +100% for new tickers
`app/api/best-recipes/movers/route.ts:243-247` — a ticker absent from the previous snapshot is reported as `percentChange: 100`, so brand-new tickers pollute the top of the "biggest movers by %" list with a made-up figure instead of being flagged as new/`null`.

### 14. Planet repairs: condition exactly 1.0 yields `-Infinity` days
`app/api/planet-repairs/route.ts:35-42,95` — the guard only excludes `minCondition <= 0.33`. For a freshly repaired building with `Condition === 1.0`, `Math.log(0.67/0.67 - 1) = Math.log(0) = -Infinity`, which is serialized and rendered as "-Infinity" days in the client table.

### 15. AEM Visualizer: Execute button is dead code and errors flash mid-typing
`app/components/AemVisualizerClient.tsx:55-71,89-102` — the `useEffect` rebuilds the chain on every keystroke of `tickerInput`, making `handleExecute` a verbatim duplicate that can never do anything new. Side effects: typing "CB" on the way to "CBS" flashes a "no recipe" error, and clearing the input leaves the last error stuck (the early return at line 57 clears `chain` but not `error`).

### 16. `sellAt=pp30` persisted on the main page silently degrades on Best Recipes
Main page offers PP30 (`ReportClient.tsx:502`) and persists it under the shared key `prun:settings:priceType`; `/api/best-recipes` only accepts `bid|ask|pp7` (`route.ts:13`) and silently falls back to `bid` (line 30). The Best Recipes page then shows bid data while none of its PriceType buttons appear selected.

### 17. `usePersistedSettings` initial state can mismatch SSR hydration
`src/hooks/usePersistedSettings.ts:40-66` — the `useState` initializer reads localStorage/URL on the client but returns `defaultValue` during SSR pre-render, producing React hydration mismatches for any user whose stored exchange differs from "ANT" (visible flicker / hydration warnings across ReportClient and BestRecipesClient).

### 18. Module-level `setInterval` in the API cache is never cleared
`app/api/best-recipes/lib/cache.ts:49-51` — the 5-minute cleanup interval keeps event-loop handles alive; in dev/hot-reload it stacks a new interval per reload, and on serverless it's pointless (instances are recycled). Use lazy cleanup on `get`/`set` instead.

### 19. Debug fields returned in production responses
`app/api/bid-update/route.ts:167-168` — `_sampleOrder` (a full raw CXOS order, including `UserNameSubmitted` and every upstream field) and `_sampleExchange` are always included. It's the requester's own data, but it inflates the payload and looks like leftover debugging.

## Nits / maintainability

- **Duplicate table components:** `Top20Table.tsx` and `CondensedOptionsTable.tsx` are 218 lines each and identical except the type name (verified by diff). One component with two call sites would do.
- **Duplicated 80-line recipe reference text** hardcoded in both `ReportClient.tsx:673-755` and `AemVisualizerClient.tsx:314-394` — will drift out of sync with actual game data; it also duplicates data already served by `/api/aem-data`.
- **Two Next configs:** `next.config.js` and `next.config.ts` both exist; Next uses the `.js` one and the `.ts` is dead. Delete one.
- **`"next": "latest"`** in `package.json` — pinned only by the lockfile; any `npm install`/lockfile refresh silently jumps major versions. Pin a range.
- **Heavy Plotly bundle:** full `plotly.js` (^3.1.1) is shipped for sankeys + one line chart; `plotly.js-dist-min` or a partial bundle would cut multiple MB. Also, the expand overlay in `BestScenarioSankey`/`AemSankey` mounts a **second** live Plotly instance alongside the inline one instead of reusing/hiding it.
- **Workflows:** no `concurrency:` groups — an overlapping scheduled + manual run of `refresh-best-recipes-gcs.yml` can lose index entries via the read-modify-write of `index.json` (lines 200-233); action refs use mutable tags (`@v4`/`@v2`) rather than SHAs; secrets handling itself is clean (`GCP_SA_KEY`, `FIO_API_KEY` via GitHub secrets only — no hardcoded credentials found anywhere).
- **`app/api/tickers/route.ts:69-72`** swallows all errors and returns `{tickers: []}` with HTTP 200, so the client can't distinguish "no tickers" from "backend down".
- **`app/api/bases-ranking/route.ts:94,174`** hardcodes `base-data-may26.json` and `snapshotDate: "May 2026"` — will silently serve stale data forever unless manually bumped.
- **Dead code:** `VALID_EXCHANGES` is defined but unused in `app/api/best-recipes/route.ts:11` and `history/route.ts:14`; `PlotlyTable.tsx` appears unreferenced by any page client.

## What looked good
API routes consistently wrap handlers in try/catch with JSON errors (no raw 500 HTML); FIO credentials are proxied per-request via headers rather than stored server-side; the history route batches snapshot fetches with bounded concurrency and leverages immutable-snapshot caching (`revalidate: 86400`); `parseTimestamp` handles the legacy malformed-timestamp format defensively; percent-change math guards division by zero throughout (`Math.abs(previous)` denominators with `!== 0` checks).

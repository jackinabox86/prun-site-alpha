# Best Recipes: The Math and Pruning Behind the Cross-Ticker Analysis

This document explains how the **Best Recipes** table (`/best-recipes`, served by
`app/api/best-recipes/route.ts`) is computed: the exact metric that defines "best",
the bottom-up pipeline, the pruning choices that make the whole-economy sweep cheap,
the stored result shape, and the caching / history / movers machinery built on top of it.

Everything here is grounded in the code as of this writing. Primary sources:

| Concern | File |
|---|---|
| Cross-ticker computation | `src/server/bestRecipes.ts` |
| Shared scenario engine | `src/core/engine.ts` |
| Scenario naming | `src/core/scenario.ts` |
| Price lookup | `src/core/price.ts`, `src/core/maps.ts` |
| Batch generation (28 datasets) | `scripts/generate-best-recipes.ts` |
| Hourly refresh + snapshots | `.github/workflows/refresh-best-recipes-gcs.yml` |
| Serving + in-memory cache | `src/server/cachedBestRecipes.ts`, `app/api/best-recipes/route.ts` |
| History / movers | `app/api/best-recipes/history/route.ts`, `app/api/best-recipes/movers/route.ts`, `app/api/best-recipes/lib/{cache,timestamp}.ts` |

---

## 1. What "best" means

For every producible ticker, the analysis enumerates *scenarios* — assignments of each
recipe input to either **BUY** (purchase on the exchange) or **MAKE** (produce it yourself
with some upstream chain) — and picks the scenario with the highest **chain-level Profit
per Area (P/A)**.

### 1.1 Per-scenario building blocks

For one recipe row and one buy/make assignment of its inputs
(`src/core/engine.ts`, scenario conversion at lines 1234–1290; identical math in
`bestOptionForTicker` at lines 815–885):

```
InputCost      = Σ (bought inputs)  amount_i × askPrice_i
               + Σ (made inputs)    amount_i × COGM_child,i          (child's cost, not market price)

ProductionCost = InputCost + WorkforceCost + Depreciation             (per batch)

OutputValue    = Σ outputs amount_j × sellPrice_j                     (byproducts included when priced)

BaseProfit     = OutputValue − ProductionCost                         (per batch)

COGM/unit      = (ProductionCost − ByproductValue) / Output1CNT       (byproduct credit)

OpportunityCost = Σ (made inputs) amount_i × baseProfitPerOutput_child,i
FinalProfit     = BaseProfit − OpportunityCost                        ("adjusted" profit)
```

`WorkforceCost` and `Depreciation` come from exchange-specific CSV columns
(`WfCst-{EXCHANGE}`, `Deprec-{EXCHANGE}`; for UNV a `7`/`30` suffix is appended —
`getCostColumnNames`, `src/core/engine.ts:27–38`). Buy prices are always the **ask**
side on standard exchanges regardless of the sell-side setting
(`getInputPriceType`, `src/core/engine.ts:19–21`); only UNV buys at pp7/pp30.
A price of `0` or missing is treated as *no price* (`toPrice`, `src/core/maps.ts:35–37`):
an unpriced input removes the BUY branch entirely, and an unpriced main output makes
`OutputValue` contribution zero (the chain can still be costed via COGM).

### 1.2 The ranking metric: chain P/A

The scenario's score is computed by `buildScenarioRows` (`src/core/engine.ts:1302–1412`),
evaluated at the ticker's own full capacity
(`dailyCapacity = Output1CNT × RunsPerDay`, `src/server/bestRecipes.ts:322–326`):

```
                 BaseProfit × RunsPerDay
profitPA  =  ─────────────────────────────────
             Area_own + Σ ChildAreaNeeded_i
```

- `BaseProfit × RunsPerDay` is the daily **base** profit (`stageProfitPerDay`,
  engine.ts:1316–1321). Note it is the *base* profit — the opportunity-cost-adjusted
  `FinalProfit` is carried on every option but is **not** what P/A ranks on
  (engine.ts:1394–1397).
- `Area_own` is the producing building's full area (`fullSelfAreaPerDay`, engine.ts:1332–1334).
- Each MAKE input contributes the area of its entire upstream chain, scaled to feed
  this ticker at full capacity, recursively:

```
ChildAreaNeeded = AreaPerOutput_child × (amount_i × RunsPerDay_parent)
                + (child's own MAKE inputs, recursively)
```

(`engine.ts:1343–1368`; `AreaPerOutput = Area / (RunsPerDay × Output1CNT)` when the CSV
column is absent, engine.ts:833–838.) Bought inputs contribute **zero** area. So MAKE
branches raise the denominator (more buildings) but usually lower the numerator's input
cost (COGM instead of ask price) — P/A is exactly the trade-off between the two.

### 1.3 Selection and tie-breaking

`refreshBestRecipeIDs` (`src/server/bestRecipes.ts:302–392`) computes `totalProfitPA`
for every option and picks the max:

```ts
options.sort((a, b) => (b.totalProfitPA || 0) - (a.totalProfitPA || 0));
const best = options[0];                        // bestRecipes.ts:329–330
```

There is **no explicit tie-breaker**. `Array.prototype.sort` is stable, so equal P/A
values resolve to *first generated*: earlier recipe rows in the CSV, and within a
recipe the enumeration order of scenarios (for each input, BUY branches are appended
before MAKE branches — engine.ts:1159–1231). `|| 0` also means an option with a
missing/NaN P/A is ranked as if it were exactly 0.

---

## 2. The computation pipeline

`refreshBestRecipeIDs(priceSource, exchange, buyPriceType, sellPriceType, preloadedRecipeData?)`
(`src/server/bestRecipes.ts:249`) runs once per dataset:

1. **Clear engine memos** (`clearScenarioCache()`, engine.ts:72–75) so stale
   exchange/price combinations never leak between runs.
2. **Load data** — recipes + prices CSVs (GCS in production; a frozen local snapshot for
   `priceSource="local"`). In extraction mode a pre-merged recipe map is passed in instead
   (see §6).
3. **Build the dependency graph** (`buildDependencyGraph`, bestRecipes.ts:172–203):
   `graph[ticker] = [input tickers of all its recipes]`.
4. **Order tickers bottom-up** by recursive depth (`computeDepth`, bestRecipes.ts:209–223):

   ```
   depth(t) = 0                          if t has no recipe (buy-only raw material)
   depth(t) = 1 + max(depth(inputs))     otherwise
   ```

   Tickers are processed in ascending depth (`getTickersInDependencyOrder`,
   bestRecipes.ts:228–238), which guarantees that when a ticker is processed, every
   ticker it can consume has already been solved and cached.
5. **Per ticker**: call the shared engine at the root with the crucial flag combination

   ```ts
   findAllMakeOptions(ticker, recipeMap, pricesMap, exchange, sellPriceType,
                      bestMapBuilding, /*depth*/ 0,
                      /*exploreAllChildScenarios*/ false,
                      /*honorRecipeIdFilter*/ false);   // bestRecipes.ts:307–317
   ```

   score every returned option with `buildScenarioRows` (§1.2), pick the max, and write
   the ticker's result into the growing `bestMapBuilding` cache **and** the output array.

### 2.1 Which tickers are included / excluded

- Every ticker appearing anywhere in the recipe sheet (as output *or* input) enters the
  ordered list.
- A ticker with **no recipe rows** produces zero options and is silently skipped
  (`if (!options || options.length === 0) continue;` bestRecipes.ts:319). Raw materials
  therefore do not appear in the standard dataset; in extraction mode they gain
  extraction recipes and do appear (§6).
- A ticker whose computation throws is logged and skipped; the run continues
  (bestRecipes.ts:388–391).
- No price-based exclusion exists: a ticker with no market price for its output is still
  listed (its `OutputValue` is 0, so P/A is typically very negative).

### 2.2 Scenario space per ticker (and how it differs from the per-ticker report)

Because `exploreAllChildScenarios=false`, the engine does **not** recursively enumerate
child scenario trees. When `findAllMakeOptions` recurses into an input at `depth > 0`
(engine.ts:918–963), it returns:

- **Up to 3 options** if `bestMapBuilding` already stores `top3DisplayScenarios` for
  that input — one option per stored *display scenario*, rebuilt and matched by name
  (`topDisplayScenarioOptionsForTicker`, engine.ts:182–220); otherwise
- **Exactly 1 option** — the memoized single best (`bestOptionForTicker`,
  engine.ts:552–894), which itself recurses using only single-best children
  (memoized in `BEST_MEMO`, cycle-guarded by a `seen` set, engine.ts:566–572).

So at the root, each input contributes at most **1 BUY branch + 3 MAKE branches**, and
the option count per recipe row is bounded by

```
options ≤ (1 + 3)^k        for k inputs   (k ≤ 10)
```

versus the full per-ticker report (`src/server/report.ts:393`), which calls the same
engine with `exploreAllChildScenarios=true`: children are exhaustively expanded down to
depth 3, kept in check by `pruneForDiversity(children, 7)` for the root's direct
children, `pruneForDiversity(grandchildren, 3)` (engine.ts:1092–1098), and cost-share
pruning (§3). The best-recipes sweep is the cheap mode of the same engine: same
formulas, drastically smaller search space, made sound by the bottom-up processing
order.

One consequence: for a given ticker, the report can find chains the sweep missed
(deep combinations outside each child's stored top 3), so a ticker's report-page best
P/A can slightly exceed its Best Recipes value.

---

## 3. Pruning choices specific to this analysis

The whole-economy sweep leans on three mechanisms:

1. **Bottom-up dynamic programming instead of tree search.** Children come from
   `bestMapBuilding`, which is filled in dependency order during the same run
   (bestRecipes.ts:298, 367–371). Each ticker is solved exactly once; cost of the
   sweep is roughly linear in (tickers × recipes × 4^inputs) rather than exponential
   in chain depth.

2. **Top-3 display-scenario diversity, not just the single best.** After ranking a
   ticker's options, they are grouped by *display scenario* — the scenario string with
   all nested `[...]` child details stripped (`scenarioDisplayName`,
   `src/core/scenario.ts:39–52`), e.g.
   `"Make C_5 [Make HCP_2 [...]] | Buy H"` → `"Make C_5 | Buy H"`. The best P/A
   representative of each group is kept and the top 3 groups are stored
   (bestRecipes.ts:332–354). This is the sweep's substitute for the report's diversity
   pruning: when a *parent* ticker later considers this ticker as an input, it sees 3
   structurally different ways to make it (e.g. "buy the feedstock" vs "make the
   feedstock"), not 3 near-identical variants of one chain. The trade-off: only 3
   shapes survive per ticker, so a shape that is mediocre for the child but ideal for
   some parent is lost.

3. **What is *not* used here.** The two adaptive pruners in the engine are inert in this
   mode because both require `exploreAllChildScenarios=true`:
   - `pruneForDiversity(options, N)` (engine.ts:97–127) — keep top N by P/A **plus** the
     best representative of every display scenario (N = 7 for the report root's children,
     3 for grandchildren).
   - `pruneByInputCostShare` (engine.ts:133–176) — per-input budgets by estimated share
     of total input cost:

     | Cost share | Child options kept |
     |---|---|
     | < 5% | 1 (single best) |
     | 5–15% | `pruneForDiversity(…, 2)` |
     | 15–30% | `pruneForDiversity(…, 5)` at depth 0, else 3 |
     | > 30% | all upstream-pruned options |

   In the best-recipes sweep the branching factor is already ≤ 4 per input, so no
   further pruning is needed.

---

## 4. The stored result shape

Each dataset is a JSON array of `BestRecipeResult` (`src/server/bestRecipes.ts:9–18`):

```jsonc
{
  "ticker": "NN",
  "recipeId": "NN",                       // recipe row of the winning option
  "scenario": "Make BAI | Make MLI",      // full scenario string incl. nested [..] details
  "profitPA": 343.98,                     // §1.2 metric of the winning option
  "buyAllProfitPA": null,                 // see below
  "building": "SE",                       // Building column of the ticker's first recipe row
  "top3DisplayScenarios": [               // §3.2 — consumed by parents and by the report
    { "displayScenario": "...", "scenario": "...", "profitPA": 343.98 }, ...
  ],
  "volume": "medium"                      // optional; added by the generation script
}
```

- **`profitPA`** — the chain P/A of the winning scenario (§1.2). This is the number in
  the "Profit P/A" column of `/best-recipes`.
- **`buyAllProfitPA`** — a deliberately simple reference number
  (`calculateBuyAllProfitPA`, bestRecipes.ts:82–164): best over the ticker's recipe rows of

  ```
  (OutputValue − Σ amount_i × buyPrice_i − WorkforceCost − Depreciation) × RunsPerDay / Area
  ```

  i.e. *buy every input, count only your own building's area*. If **any** input of a
  recipe lacks a market price the recipe is disqualified; if all recipes are
  disqualified the value is `null` (displayed as "N/A"). Comparing `profitPA` with
  `buyAllProfitPA` shows how much of the profit comes from vertical integration.
- **`top3DisplayScenarios`** — also the pruning vehicle (§3). Note the stored
  `bestMapBuilding` entry normalizes `recipeId` to `null` (bestRecipes.ts:367–371),
  so children are matched by scenario string, never filtered by recipe ID.
- **`volume`** — a market-liquidity label merged in by `scripts/generate-best-recipes.ts`
  (lines 72–83) from a weekly classification CSV. The classifier
  (`scripts/classify-production-volume.ts:91–99`, cron Mondays 07:00 UTC) uses 30-day
  average traded units vs production rates:

  ```
  "extremely low"  if avgTraded30d < outputPerDay
  "low"            if avgTraded30d < 3 × fullBaseOutputPerDay
  "medium"         if avgTraded30d < 8 × fullBaseOutputPerDay
  "high"           otherwise
  ```

  The UI's default volume filter hides "extremely low"
  (`DEFAULT_VOLUME_LEVELS`, `app/best-recipes/BestRecipesClient.tsx:53`).

ROI, payback and similar metrics are **not** stored here — they belong to the
per-ticker report (`src/core/roi.ts` et al.). Chain *structure* is encoded entirely in
the `scenario` string (`composeScenario`, `src/core/scenario.ts:9–27`): pipes separate
sibling inputs, brackets nest child chains.

Each dataset file has a sibling `*-meta.json`:

```json
{ "outputName": "ANT-bid", "exchange": "ANT", "mode": "standard",
  "generatedAt": "…ISO…", "tickerCount": 262, "durationSeconds": 5.16 }
```

---

## 5. Generation, caching, refresh, history, movers

### 5.1 Generation (28 files)

`scripts/generate-best-recipes.ts` builds every variant in one run:

```
(ANT, CIS, ICA, NCC) × (bid, ask, pp7)   = 12 configs   (buy at ask, sell at sellAt)
+ UNV7  (buy & sell at pp7)
+ UNV30 (buy & sell at pp30)
= 14 configs × (standard, extraction)     = 28 JSON files (+ 28 meta files)
```

Files land in `public/data/best-recipes-{NAME}[-Extraction].json` where `NAME` is
`{EXCHANGE}-{sellAt}` for standard exchanges and `UNV7`/`UNV30` for Universe.
`best-recipes.json` / `best-recipes-meta.json` are a backwards-compatible copy of
ANT-bid standard. (`best-recipes-315.json` is a frozen legacy snapshot used by
`priceSource=local` testing, `src/lib/config.ts:13`.)

### 5.2 Hourly refresh workflow

`.github/workflows/refresh-best-recipes-gcs.yml`:

- **Cron `10 * * * *`** — hourly at :10, ten minutes after the price-refresh workflow
  (which itself runs every 30 minutes, `refresh-prices.yml`). Also runs on pushes that
  touch `src/server/bestRecipes.ts` or `src/core/engine.ts`, and on manual dispatch.
- Runs `npm run generate-best-recipes` against live GCS CSVs, then uploads all 28
  data + 28 meta files to `gs://prun-site-alpha-bucket/` with `Cache-Control: max-age=300`.
- **Historical snapshots only every 8 hours** — when `UTC hour % 8 == 0` (00, 08, 16),
  each file is additionally copied to
  `historical/{config}/{TIMESTAMP}.json` with `max-age=31536000` (immutable), and the
  per-config `historical/{config}/index.json` gets a new entry
  `{ timestamp, generatedAt, tickerCount, durationSeconds }` (workflow lines 59–254).

### 5.3 Serve-time caching

- `cachedBestRecipes` (`src/server/cachedBestRecipes.ts`) is a per-process singleton
  keyed `${priceSource}-${exchange}-${sellAt}-${mode}`. On first request it fetches
  `best-recipes-{exchange}-{sellAt}[-Extraction].json` (+ meta) from GCS
  (`cache: 'no-store'`) or disk, and **caches it with no TTL** — freshness relies on
  serverless instance recycling or an explicit `?clearCache=true` on the API
  (`app/api/best-recipes/route.ts:35–38`). Concurrent first loads are deduplicated via
  an init-promise map.
- The history/movers endpoints use a separate tiny in-memory TTL cache
  (`app/api/best-recipes/lib/cache.ts`) with **5-minute** entries and a 5-minute
  cleanup interval.
- `lib/timestamp.ts` normalizes an older malformed snapshot-timestamp format
  (`2025-11-07T20-01-54Z` → `20:01:54`) so old and new snapshots sort correctly.

### 5.4 History math

`GET /api/best-recipes/history?ticker=X&exchange=E&sellAt=S[&limit≤1000][&from][&to]`
(`history/route.ts`):

1. Fetch `historical/best-recipes-{E}-{S}/index.json`, filter by date range, sort
   descending, take `limit` (default 100, clamped to [1, 1000]).
2. Fetch those snapshots (bounded concurrency 25; immutable snapshots are fetched with
   `next: { revalidate: 86400 }`), extract the ticker's row from each.
3. Sort ascending and compute per-step deltas (lines 167–202):

```
changeFromPrevious = PA_t − PA_{t−1}
percentChange      = (PA_t − PA_{t−1}) / |PA_{t−1}| × 100     (undefined if PA_{t−1} = 0 or first point)
```

and identically for `buyAllProfitPA` (skipped across `null` values).

### 5.5 Movers math

`GET /api/best-recipes/movers?period=1d|7d|30d&…` (`movers/route.ts`):

1. `current` = most recent snapshot; `target = current − period`;
   `previous` = the latest snapshot with `timestamp ≤ target`
   (`findClosestSnapshot`, lines 67–77) — so a "1d" comparison is really
   "vs. the newest snapshot at least ~1 day old".
2. For every ticker in `current`:

```
absoluteChange = PA_now − PA_prev
percentChange  = absoluteChange / |PA_prev| × 100     (0 if PA_prev = 0)
recipeChanged  = recipeId_now ≠ recipeId_prev
```

   A ticker absent from the previous snapshot is treated as
   `percentChange = 100`, `absoluteChange = PA_now` (lines 236–254).
3. Sort by `|percentChange|` (default) or `|absoluteChange|`, take `limit`
   (default 50, clamped to [1, 500]).

---

## 6. Region, pricing mode, and extraction variants

**There is one precomputed dataset per (exchange, sell-price, mode) combination** — the
server never recomputes; it only selects a file.

- **Region/exchange** — determines which price columns are read
  (`AI1-*` → ANT, `CI1-*` → CIS, `IC1-*` → ICA, `NC1-*` → NCC; `buildPriceMap`,
  `src/core/maps.ts`) and which cost columns (`WfCst-{EX}`, `Deprec-{EX}`,
  `AllBuildCst-{EX}`) feed the formulas.
- **Pricing mode (`sellAt`)** — `bid` (default, conservative fill), `ask` (optimistic),
  or `pp7` (7-day average). This affects *output valuation only*; inputs are always
  bought at **ask** on standard exchanges (engine.ts:19–21).
- **UNV** — the Universe pseudo-exchange has no order book, so both sides use price
  averages: `UNV7` buys **and** sells at pp7, `UNV30` at pp30, with cost columns
  suffixed `-UNV7` / `-UNV30` (engine.ts:27–38; `scripts/generate-best-recipes.ts:108–109`).
  These datasets are generated and uploaded but not exposed in the `/best-recipes` UI
  (which offers only ANT/CIS/ICA/NCC × bid/ask/pp7 — `BestRecipesClient.tsx:30–44`).
  Note a latent mismatch: the generator writes `best-recipes-UNV7.json`, while the
  server's URL builder would request `best-recipes-UNV7-{sellAt}.json`
  (`src/lib/config.ts:74–82`), so the UNV files are effectively write-only today.
- **Extraction mode** — before running the sweep, the generator merges
  `static/{EXCHANGE}-expandedrecipes-dynamic.csv` (planet-specific extraction recipes,
  with the `Planet` column stripped to align schemas) into the standard recipe map
  (`generate-best-recipes.ts:154–196`). Raw ores/gases thereby gain recipe rows, get a
  depth > 0 in the dependency graph, and appear in the output with extraction chains
  competing against buying. If no expanded file exists for an exchange, the extraction
  dataset simply equals the standard one. Files carry the `-Extraction` suffix and are
  selected by `?extractionMode=true` (`route.ts:22, 33`).

At serve time `GET /api/best-recipes?exchange=E&sellAt=S&extractionMode=B` validates the
parameters (falling back to `ANT`/`bid`/standard) and maps them 1:1 to a file name via
`getBestRecipesForExchange` (`src/lib/config.ts:22–25, 74–82`).

---

## 7. Worked example: NN on ANT, sell at bid

Using the frozen local snapshot (`public/data/recipes-legacy.csv`,
`public/data/prices-legacy.csv`, results in `public/data/best-recipes.json`). NN is made
in an SE from 1 BAI + 1 MLI; BAI and MLI are input-less recipes made in SDs.

**Step 1 — BAI (depth < NN, solved first).** SD: workforce 3,375.63, depreciation
1,456.94, area 27, 0.8 runs/day, output 1 BAI. ANT bid = 17,000.

```
BaseProfit = 17,000 − (3,375.63 + 1,456.94)      = 12,167.43 / batch
profitPA   = 12,167.43 × 0.8 / 27                = 360.516     ✓ stored: 360.5164
COGM/unit  = 4,832.57        AreaPerOutput = 27 / (0.8 × 1) = 33.75
```

No inputs → scenario `""`, and `buyAllProfitPA = profitPA`.

**Step 2 — MLI.** SD: workforce 5,063.44, depreciation 2,185.42, area 27,
0.5333 runs/day. ANT bid = 24,000.

```
BaseProfit = 24,000 − 7,248.86 = 16,751.14
profitPA   = 16,751.14 × 0.53333 / 27 = 330.885   ✓ stored: 330.8846
COGM/unit  = 7,248.86        AreaPerOutput = 50.625
```

**Step 3 — NN.** SE: workforce 5,473.97, depreciation 2,423.33, area 24.8,
1.0667 runs/day, sells at bid 57,000. Both children are already in `bestMapBuilding`,
so each input offers a BUY branch (if an ask exists) plus up to 3 MAKE branches.
For scenario **`Make BAI | Make MLI`**:

```
InputCost  = COGM_BAI + COGM_MLI = 4,832.57 + 7,248.86            = 12,081.43
BaseProfit = 57,000 − 12,081.43 − 5,473.97 − 2,423.33             = 37,021.27 / batch
Numerator  = 37,021.27 × 1.06667                                  = 39,489.4 / day

Denominator = 24.8                       (own SE area)
            + 33.75  × (1 × 1.06667)     (BAI chain, 36.0)
            + 50.625 × (1 × 1.06667)     (MLI chain, 54.0)        = 114.8

profitPA   = 39,489.4 / 114.8 = 343.99    ✓ stored: 343.9842 → selected as best
```

The stored runner-up display scenario, `Make BAI | Buy MLI` (250.35), swaps MLI's COGM
for its generation-time ask price: the denominator shrinks to 60.8 (a bought input adds
no area) but the input cost rises more than proportionally, so it loses. And because
MLI had **no ask price on ANT** in this snapshot's CSV, `calculateBuyAllProfitPA`
disqualified NN's only recipe → `buyAllProfitPA: null` ("N/A" in the UI).

For the record, the opportunity-cost-adjusted profit of the winner is
`37,021.27 − (12,167.43 + 16,751.14) = 8,102.70` per batch — positive, meaning making
NN beats selling the BAI/MLI intermediates directly; but as noted in §1.2, this number
does not participate in the P/A ranking.

---

## Appendix: quirks worth knowing

- **P/A ranks on base profit, not opportunity-cost-adjusted profit** (engine.ts:1316–1321,
  1394–1397). Two tickers can both look great on P/A while one of them would be better
  served by selling its intermediates.
- **The serve-time dataset cache has no TTL** (`cachedBestRecipes`); GCS files refresh
  hourly, but a long-lived server instance keeps its first download until
  `?clearCache=true` or a restart.
- **Ties are broken by CSV row / enumeration order** via stable sort, and missing P/A
  coalesces to 0 in the comparator.
- **Movers treat brand-new tickers as +100%**, which can crowd the top of the
  percent-sorted list after recipe-data changes.
- **History resolution is 8 hours** (snapshot gating in the workflow), even though the
  live datasets refresh hourly.
- **UNV7/UNV30 datasets are generated but unreachable** through the current API URL
  scheme (file-name mismatch, §6).

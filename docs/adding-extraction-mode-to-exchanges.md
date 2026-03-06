# Adding Extraction Mode & Expanded Recipes to CIS, ICA, and NCC Exchanges

This guide documents how extraction mode and expanded recipes were implemented for the ANT exchange, and provides step-by-step instructions for replicating the same functionality for the remaining three exchanges: **CIS** (BEN), **ICA** (HRT), and **NCC** (MOR).

---

## Overview: What Extraction Mode Does

Extraction mode adds planet-specific extraction recipes to the analysis engine. For each exchange, this requires:

1. **Data files** — CSVs with extraction recipes and planet conditions
2. **Cost calculation** — A script that computes planet-specific workforce/build costs
3. **Best recipes generation** — Pre-computed optimal recipes that include extraction variants
4. **Runtime merging** — The report API loads and merges expanded recipes at request time
5. **UI updates** — The toggle button and extraction planets reference table

---

## What Already Works for All Exchanges (No Changes Needed)

The following infrastructure is **already exchange-agnostic** and handles any exchange value automatically:

| Component | File | Why It Already Works |
|---|---|---|
| Config file paths | `src/lib/config.ts:22-25, 74-82` | `getBestRecipesForExchange(exchange, sellAt, mode)` accepts any exchange |
| Best recipes cache | `src/server/cachedBestRecipes.ts` | Cache key includes exchange, loads dynamically |
| Best recipes API | `app/api/best-recipes/route.ts:22-33` | Passes `extractionMode` through for any exchange |
| Best recipes generation | `scripts/generate-best-recipes.ts:61-132` | Already generates extraction variants for ALL exchanges (falls back gracefully if no expanded recipes CSV exists) |
| GCS upload workflow | `.github/workflows/refresh-best-recipes-gcs.yml:61-105` | Already uploads extraction files for ANT, CIS, ICA, NCC |

---

## Step-by-Step: What You Need to Do Per Exchange

Repeat these steps for each of **CIS**, **ICA**, and **NCC**.

### Step 1: Create the Data Files (Manual / Spreadsheet Work)

You need two CSV files per exchange, uploaded to GCS static storage:

#### A. `{EXCHANGE}-expandedrecipes.csv`

This is the raw expanded recipes file with planet-specific extraction data. It has the same columns as the standard `recipes.csv` **plus a `Planet` column**.

**Location:** `https://storage.googleapis.com/prun-site-alpha-bucket/static/{EXCHANGE}-expandedrecipes.csv`

**Format** (same structure as `ANT-expandedrecipes.csv`):
```
RecipeID,Building,Ticker,Runs P/D,Area,Planet,Output1CNT,Output1MAT,...,Input1CNT,Input1MAT,...
```

The `Planet` column is what distinguishes expanded recipes from standard ones — it gets stripped at runtime so the rest of the engine treats them like normal recipes.

#### B. `{EXCHANGE}-extractionplanets.csv`

This is the planet conditions matrix that the cost calculator uses to adjust workforce and building costs.

**Location:** `https://storage.googleapis.com/prun-site-alpha-bucket/static/{EXCHANGE}-extractionplanets.csv`

**Format** (same structure as `ANT-extractionplanets.csv`):
```
Planet,MCG,AEF,SEA,HSE,INS,TSH,MGC,BL
SomePlanet,Y,N,N,Y,N,N,N,N
...
```

Each row is a planet, each column (MCG, AEF, SEA, HSE, INS, TSH, MGC, BL) is Y/N indicating whether that condition applies.

#### Upload to GCS:
```bash
gsutil cp {EXCHANGE}-expandedrecipes.csv gs://prun-site-alpha-bucket/static/{EXCHANGE}-expandedrecipes.csv
gsutil cp {EXCHANGE}-extractionplanets.csv gs://prun-site-alpha-bucket/static/{EXCHANGE}-extractionplanets.csv
```

---

### Step 2: Run the Cost Calculator to Generate Dynamic Costs

**File:** `scripts/calculate-expanded-costs.ts`

This script reads the raw expanded recipes and extraction planets CSVs, calculates planet-specific workforce costs, depreciation, and build costs, then outputs a `{EXCHANGE}-expandedrecipes-dynamic.csv` file.

#### What to change:

**Line 247** — Add the exchange to the processing list:

```typescript
// BEFORE (ANT only):
const EXCHANGES_TO_PROCESS: Exchange[] = ["ANT"];

// AFTER (all exchanges):
const EXCHANGES_TO_PROCESS: Exchange[] = ["ANT", "CIS", "ICA", "NCC"];
```

#### Run the script:
```bash
npm run calculate-expanded-costs
```

This will:
1. Fetch `{EXCHANGE}-expandedrecipes.csv` from GCS static (line 496)
2. Fetch `{EXCHANGE}-extractionplanets.csv` from GCS static (line 497)
3. Calculate costs per recipe per planet
4. Output `{EXCHANGE}-expandedrecipes-dynamic.csv`

#### Upload the dynamic file to GCS:
```bash
gsutil cp {EXCHANGE}-expandedrecipes-dynamic.csv gs://prun-site-alpha-bucket/static/{EXCHANGE}-expandedrecipes-dynamic.csv
```

---

### Step 3: Update the Report API to Load Expanded Recipes for the Exchange

**File:** `src/server/report.ts`

Currently, extraction recipe merging is **hardcoded to ANT only** at line 117:

```typescript
// BEFORE (line 117):
if (extractionMode && exchange === "ANT") {

// AFTER (support all exchanges):
if (extractionMode && ["ANT", "CIS", "ICA", "NCC"].includes(exchange)) {
```

Also update the dynamic CSV URL to use the exchange variable instead of hardcoded "ANT" (lines 118-120):

```typescript
// BEFORE:
const expandedRecipeUrl = priceSource === "gcs"
  ? `${GCS_STATIC_BASE}/ANT-expandedrecipes-dynamic.csv`
  : "public/data/ANT-expandedrecipes-dynamic.csv";

// AFTER:
const expandedRecipeUrl = priceSource === "gcs"
  ? `${GCS_STATIC_BASE}/${exchange}-expandedrecipes-dynamic.csv`
  : `public/data/${exchange}-expandedrecipes-dynamic.csv`;
```

Update the error message at line 164:
```typescript
// BEFORE:
throw new Error(`Failed to load ANT expanded recipes: ${error.message || error}`);

// AFTER:
throw new Error(`Failed to load ${exchange} expanded recipes: ${error.message || error}`);
```

---

### Step 4: Update the Tickers API to Load Expanded Recipes for the Exchange

**File:** `app/api/tickers/route.ts`

Currently hardcoded to ANT at lines 31-34:

```typescript
// BEFORE (line 31-34):
if (extractionMode) {
  try {
    const expandedRecipeUrl = `${GCS_STATIC_BASE}/ANT-expandedrecipes-dynamic.csv`;

// AFTER — accept exchange parameter and use it:
```

Full changes needed:

1. Extract the `exchange` param from the URL query string (currently not read):
```typescript
const exchange = (url.searchParams.get("exchange")?.toUpperCase() || "ANT") as Exchange;
```

2. Use the exchange in the expanded recipe URL:
```typescript
const expandedRecipeUrl = `${GCS_STATIC_BASE}/${exchange}-expandedrecipes-dynamic.csv`;
```

3. Add the exchange condition check:
```typescript
if (extractionMode && ["ANT", "CIS", "ICA", "NCC"].includes(exchange)) {
```

4. Also verify that `ReportClient.tsx` passes the exchange to the tickers API call. Check the fetch call around lines 75-86 — if it doesn't include `&exchange=${exchange}`, add it.

---

### Step 5: Update the UI — Enable the Extraction Toggle for All Exchanges

**File:** `app/components/ReportClient.tsx`

The extraction button is currently disabled for non-ANT exchanges. Update the guard conditions:

#### Line 467 (label title):
```typescript
// BEFORE:
title={exchange !== "ANT" ? "Extraction mode only available for ANT exchange" : "Include planet-specific extraction recipes"}

// AFTER:
title={exchange === "UNV" ? "Extraction mode not available for UNV exchange" : "Include planet-specific extraction recipes"}
```

#### Line 473 (button disabled):
```typescript
// BEFORE:
disabled={exchange !== "ANT"}

// AFTER:
disabled={exchange === "UNV"}
```

#### Line 480 (opacity):
```typescript
// BEFORE:
opacity: exchange !== "ANT" ? 0.4 : 1,

// AFTER:
opacity: exchange === "UNV" ? 0.4 : 1,
```

#### Line 481 (cursor):
```typescript
// BEFORE:
cursor: exchange !== "ANT" ? "not-allowed" : "pointer"

// AFTER:
cursor: exchange === "UNV" ? "not-allowed" : "pointer"
```

#### Line 483 (button title):
```typescript
// BEFORE:
title={exchange !== "ANT" ? "Extraction mode only available for ANT exchange" : ""}

// AFTER:
title={exchange === "UNV" ? "Extraction mode not available for UNV exchange" : ""}
```

---

### Step 6: Add Extraction Planets Reference Data to the UI

**File:** `app/components/ReportClient.tsx`, lines 202-242

The `extractionPlanetsData` object has placeholder `null` values for CIS, ICA, and NCC. Populate them with the actual extraction planet data for each exchange:

```typescript
const extractionPlanetsData: Record<Exchange, string | null> = {
  ANT: `TICKER  PLANET      DAILY OUTPUT
------  ----------  ------------
AMM     Romulus     33.13
...`, // (existing data)
  CIS: `TICKER  PLANET      DAILY OUTPUT
------  ----------  ------------
...`,  // ADD YOUR CIS DATA HERE
  ICA: `TICKER  PLANET      DAILY OUTPUT
------  ----------  ------------
...`,  // ADD YOUR ICA DATA HERE
  NCC: `TICKER  PLANET      DAILY OUTPUT
------  ----------  ------------
...`,  // ADD YOUR NCC DATA HERE
  UNV: null
};
```

Get this data from each exchange's `{EXCHANGE}-expandedrecipes.csv` — extract the unique Ticker, Planet, and daily output values.

---

## Summary Checklist

For each exchange (CIS, ICA, NCC), check off:

- [ ] **Data:** `{EXCHANGE}-expandedrecipes.csv` created and uploaded to GCS static
- [ ] **Data:** `{EXCHANGE}-extractionplanets.csv` created and uploaded to GCS static
- [ ] **Script:** `scripts/calculate-expanded-costs.ts` line 247 — exchange added to `EXCHANGES_TO_PROCESS`
- [ ] **Script:** Cost calculator run, `{EXCHANGE}-expandedrecipes-dynamic.csv` uploaded to GCS static
- [ ] **API:** `src/server/report.ts` line 117 — exchange guard expanded (or use the exchange variable dynamically)
- [ ] **API:** `src/server/report.ts` lines 118-120 — hardcoded "ANT" replaced with `${exchange}`
- [ ] **API:** `app/api/tickers/route.ts` — exchange param read and used in expanded recipe URL
- [ ] **UI:** `app/components/ReportClient.tsx` — extraction toggle enabled for non-UNV exchanges
- [ ] **UI:** `app/components/ReportClient.tsx` — `extractionPlanetsData` populated for the exchange
- [ ] **Test:** Verify extraction mode toggle works when selecting the exchange
- [ ] **Test:** Verify extraction recipes appear in report results
- [ ] **Test:** Verify tickers API returns extraction-only tickers when mode is enabled

---

## Files Modified (Complete List)

| File | Change |
|---|---|
| `scripts/calculate-expanded-costs.ts` | Add exchanges to `EXCHANGES_TO_PROCESS` array |
| `src/server/report.ts` | Expand ANT-only guard to all standard exchanges; parameterize CSV URL |
| `app/api/tickers/route.ts` | Accept exchange param; parameterize expanded recipe URL |
| `app/components/ReportClient.tsx` | Enable toggle for non-UNV; populate extraction planets data |

## Files That Need NO Changes

| File | Why |
|---|---|
| `src/lib/config.ts` | Already exchange-agnostic |
| `src/server/cachedBestRecipes.ts` | Already exchange-agnostic |
| `app/api/best-recipes/route.ts` | Already exchange-agnostic |
| `scripts/generate-best-recipes.ts` | Already generates extraction variants for all exchanges |
| `.github/workflows/refresh-best-recipes-gcs.yml` | Already uploads for all exchanges |

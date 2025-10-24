# Dynamic Cost Calculation System

This document explains how dynamic workforce, depreciation, and build costs are calculated based on current market prices.

## Overview

Previously, `WfCst`, `Deprec`, and `AllBuildCst` in recipes.csv were static values. Now they're dynamically calculated every 30 minutes based on current material prices.

## Architecture

```
Every 30 minutes:
1. Fetch latest prices from game APIs
2. Load material requirements from GCS
3. Calculate dynamic costs: requirements × current prices
4. Update recipes.csv with new costs
5. Upload to GCS
6. Best-recipes generation uses updated data (10 min later)
```

## Cost Calculation Formula

### Building-Level Daily Costs

- **Daily Workforce Cost** = Σ(workforce material requirements × current prices)
- **Total Build Cost** = Σ(build material requirements × current prices)
- **Daily Depreciation** = (Total Build Cost ÷ 180 days) if PRODUCTION building, else 0

### Recipe-Level Costs (in recipes.csv)

- **WfCst** = Daily Workforce Cost ÷ Runs P/D (per batch cost)
- **Deprec** = Daily Depreciation ÷ Runs P/D (per batch cost)
- **AllBuildCst** = Total Build Cost (NOT divided - one-time total)

### Example

AAF building:
- Daily workforce cost: 10,000 ICA
- Total build cost: 1,468,840 ICA
- Recipe with 0.8 runs/day:
  - WfCst = 10,000 ÷ 0.8 = 12,500 per batch
  - Deprec = (1,468,840 ÷ 180) ÷ 0.8 = 10,200 per batch
  - AllBuildCst = 1,468,840 (same for all AAF recipes)

## Data Files

### Input Files (on GCS)

1. **workforce-requirements.csv** - Material needs for workforce per building
   - Location: `gs://prun-site-alpha-bucket/workforce-requirements.csv`
   - Structure: Building, Input1MAT, Input1CNT, ..., Input5MAT, Input5CNT
   - Update: Manually when game changes (rarely)

2. **build-requirements.csv** - Construction materials per building
   - Location: `gs://prun-site-alpha-bucket/build-requirements.csv`
   - Structure: Building, BuildingType, Input1MAT, Input1CNT, ..., Input10MAT, Input10CNT
   - BuildingType: "PRODUCTION" (depreciates) or "HABITATION" (doesn't depreciate)
   - Update: Manually when game changes (rarely)

3. **recipes.csv** (base) - Authoritative recipe data
   - Location: `gs://prun-site-alpha-bucket/recipes.csv`
   - This is the base file that gets dynamically updated
   - Backup available as `recipes-base.csv`

4. **prices.csv** - Current market prices (auto-updated every 30 min)
   - Location: `gs://prun-site-alpha-bucket/prices.csv`

### Output Files

- **recipes.csv** - Recipes with dynamic costs (overwrites base)
  - Generated every 30 minutes by GitHub Actions
  - Used by entire application

## Scripts

### `scripts/calculate-dynamic-costs.ts`

Main calculation script that:
1. Fetches all required CSVs from GCS
2. Builds lookup maps for prices, workforce, and build requirements
3. For each recipe, calculates WfCst, Deprec, AllBuildCst
4. Outputs `public/data/recipes-dynamic.csv`

**Environment Variables:**
- `GCS_RECIPES_URL` - Base recipes CSV
- `GCS_PRICES_URL` - Current prices CSV
- `GCS_WORKFORCE_URL` - Workforce requirements CSV
- `GCS_BUILD_URL` - Build requirements CSV

**Run locally:**
```bash
npm run calculate-costs
```

## GitHub Actions Workflow

### `.github/workflows/refresh-prices.yml`

Updated workflow that runs every 30 minutes:

1. Fetch prices from FNAR and PrunPlanner APIs
2. Merge price data → `prices.csv`
3. **Calculate dynamic costs** → `recipes-dynamic.csv`
4. Upload both to GCS
5. Best-recipes workflow runs 10 min later (unchanged)

## Setup Instructions

### Initial Setup (One-Time)

1. **Populate the requirement CSVs:**
   - Fill `public/data/workforce-requirements.csv` with all buildings
   - Fill `public/data/build-requirements.csv` with all buildings

2. **Upload to GCS:**
   ```bash
   gsutil -h "Cache-Control:public, max-age=86400" \
          cp public/data/workforce-requirements.csv \
          gs://prun-site-alpha-bucket/workforce-requirements.csv

   gsutil -h "Cache-Control:public, max-age=86400" \
          cp public/data/build-requirements.csv \
          gs://prun-site-alpha-bucket/build-requirements.csv
   ```

3. **Create backup of base recipes:**
   ```bash
   gsutil cp gs://prun-site-alpha-bucket/recipes.csv \
             gs://prun-site-alpha-bucket/recipes-base.csv
   ```

4. **Merge to main:**
   - The workflow will automatically start calculating dynamic costs

### Updating Requirements (When Game Changes)

1. Update the CSV files locally
2. Upload to GCS (same commands as above)
3. Next workflow run will use updated requirements

## Testing

### Safe GitHub Actions Testing (RECOMMENDED)

The workflow automatically enters **TEST MODE** when run from non-main branches, uploading to separate test files instead of overwriting production data.

**Branch-based file naming:**
- `main` branch → `recipes.csv`, `prices.csv` (PRODUCTION)
- Other branches → `recipes-test.csv`, `prices-test.csv` (TEST - safe!)

**To test safely in GitHub Actions:**

1. Push your branch to GitHub:
   ```bash
   git push -u origin dynamic-cost
   ```

2. Go to GitHub → Actions → "Refresh Prices (Google Cloud Storage)"

3. Click "Run workflow" → Select branch: `dynamic-cost` → Run workflow

4. The workflow will:
   - Show "⚠️ TEST MODE" warnings throughout
   - Upload to `recipes-test.csv` and `prices-test.csv`
   - **NOT touch production files**

5. Inspect the test output:
   - https://storage.googleapis.com/prun-site-alpha-bucket/recipes-test.csv
   - https://storage.googleapis.com/prun-site-alpha-bucket/prices-test.csv

6. Once verified, merge to main for production deployment

### Local Testing

1. **Set environment variables:**
   ```bash
   export GCS_RECIPES_URL=https://storage.googleapis.com/prun-site-alpha-bucket/recipes.csv
   export GCS_PRICES_URL=https://storage.googleapis.com/prun-site-alpha-bucket/prices.csv
   export GCS_WORKFORCE_URL=https://storage.googleapis.com/prun-site-alpha-bucket/workforce-requirements.csv
   export GCS_BUILD_URL=https://storage.googleapis.com/prun-site-alpha-bucket/build-requirements.csv
   ```

2. **Run the script:**
   ```bash
   npm run calculate-costs
   ```

3. **Check output:**
   ```bash
   head -n 20 public/data/recipes-dynamic.csv
   ```

**Note:** Local testing only tests the calculation script, not the full GitHub Actions workflow or GCS upload.

## Impact on Application

**All these components automatically use the dynamic costs:**

- ✅ Main production analysis (`src/server/report.ts`)
- ✅ Best recipes calculation (`src/server/bestRecipes.ts`)
- ✅ Profit per area calculations (`src/core/engine.ts`)
- ✅ ROI analysis (`src/core/roi.ts`)
- ✅ Input payback calculations (`src/core/inputPayback.ts`)
- ✅ All scenario comparisons
- ✅ Every API endpoint

**No code changes needed** - they all read from `recipes.csv` via `loadAllFromCsv()`.

## Files Modified

- `public/data/workforce-requirements.csv` - NEW placeholder (you populate)
- `public/data/build-requirements.csv` - NEW placeholder (you populate)
- `scripts/calculate-dynamic-costs.ts` - NEW calculation script
- `package.json` - Added "calculate-costs" npm script
- `.github/workflows/refresh-prices.yml` - Added dynamic cost calculation step

## Troubleshooting

**Problem: Script fails with "No price found for X"**
- Solution: That material doesn't have market data. Either add fallback or verify the ticker is correct in requirements CSV.

**Problem: Costs seem too high/low**
- Solution: Check the Runs P/D value for that recipe. Remember costs are per-batch, not per-day.

**Problem: AllBuildCst is different for same building**
- Solution: This is a bug - all recipes for same building should have same AllBuildCst. Check the calculation logic.

**Problem: Workflow fails to upload**
- Solution: Check GCP credentials and bucket permissions.

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

### Prerequisites

✅ **Already configured (no action needed):**
- GitHub secret `GCP_SA_KEY` (already exists - used by existing workflows)
- Environment variables in workflow (hardcoded in `.github/workflows/refresh-prices.yml`)
- npm dependencies (already in package.json)
- GCS bucket `prun-site-alpha-bucket` (already exists)

### Required Actions (One-Time Setup)

**You MUST complete these steps before merging to main:**

#### Step 1: Populate the Requirement CSVs

Edit these local files with complete building data:
- `public/data/workforce-requirements.csv`
- `public/data/build-requirements.csv`

**CSV Structures:**

`workforce-requirements.csv`:
```csv
Building,Input1MAT,Input1CNT,Input2MAT,Input2CNT,Input3MAT,Input3CNT,Input4MAT,Input4CNT,Input5MAT,Input5CNT
AAF,DW,100,PE,20,RAT,5,,,,,
AML,PIo,80,RAT,3,,,,,,,
```

`build-requirements.csv`:
```csv
Building,BuildingType,Input1MAT,Input1CNT,Input2MAT,Input2CNT,...,Input10MAT,Input10CNT
AAF,PRODUCTION,AEF,10,BSE,20,MCG,8,...
HAB,HABITATION,AEF,5,BSE,10,...
```

**Important notes:**
- Include ALL buildings that appear in recipes.csv
- BuildingType must be either "PRODUCTION" or "HABITATION"
- Use empty cells (,,,) for unused input slots
- Material tickers must match exactly with prices.csv

#### Step 2: Upload Requirements to GCS

After populating the CSVs, upload them:

```bash
# Upload workforce requirements
gsutil -h "Cache-Control:public, max-age=86400" \
       cp public/data/workforce-requirements.csv \
       gs://prun-site-alpha-bucket/workforce-requirements.csv

# Upload build requirements
gsutil -h "Cache-Control:public, max-age=86400" \
       cp public/data/build-requirements.csv \
       gs://prun-site-alpha-bucket/build-requirements.csv
```

**Verify uploads:**
```bash
gsutil ls -lh gs://prun-site-alpha-bucket/workforce-requirements.csv
gsutil ls -lh gs://prun-site-alpha-bucket/build-requirements.csv
```

#### Step 3: Create Backup of Production Recipes

Before the first run, backup your current recipes.csv:

```bash
gsutil cp gs://prun-site-alpha-bucket/recipes.csv \
          gs://prun-site-alpha-bucket/recipes-base.csv
```

This gives you a recovery point if needed.

#### Step 4: Test the Workflow (BEFORE merging to main!)

See "Testing" section below for safe testing instructions.

#### Step 5: Merge to Main

Once testing confirms everything works:
- Create a pull request from `dynamic-cost` → `main`
- Merge the PR
- The workflow will automatically run every 30 minutes on the `main` branch
- Dynamic costs will update continuously based on market prices

### No Other Setup Required

**You do NOT need to:**
- ❌ Create any environment variables in GitHub (already in workflow)
- ❌ Add any new GitHub secrets (GCP_SA_KEY already exists)
- ❌ Modify GCS bucket permissions (already configured)
- ❌ Install any additional npm packages (already in package.json)
- ❌ Create any other files or configurations

### Updating Requirements (When Game Changes)

1. Update the CSV files locally
2. Upload to GCS (same commands as above)
3. Next workflow run will use updated requirements

## Testing

### Pre-Flight Checklist

Before testing, ensure you've completed:
- ✅ Populated `public/data/workforce-requirements.csv` with all building data
- ✅ Populated `public/data/build-requirements.csv` with all building data
- ✅ Uploaded both CSVs to GCS (see Step 2 in Setup Instructions)
- ✅ Created backup: `recipes-base.csv` on GCS (see Step 3 in Setup Instructions)

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

### CSV Format Issues

**Problem: Workflow fails with "Cannot read property of undefined"**
- **Cause:** CSV headers don't match expected format
- **Solution:** Ensure CSVs have exact headers as shown in Setup Instructions
- **Check:** No extra spaces, correct capitalization (e.g., `BuildingType` not `buildingtype`)

**Problem: "Building X not found" warnings in logs**
- **Cause:** recipes.csv contains buildings not in your requirement CSVs
- **Solution:** Add all buildings from recipes.csv to both workforce-requirements.csv and build-requirements.csv
- **Quick check:** `grep "^[A-Z]" recipes.csv | cut -d',' -f1 | sort -u` lists all buildings

**Problem: Script fails with "No price found for X"**
- **Cause:** Material ticker in requirements doesn't have market data
- **Solution:**
  - Verify ticker spelling matches prices.csv exactly (case-sensitive)
  - Check if that material trades on any exchange
  - Script will warn and skip, but calculations continue

**Problem: Empty or zero costs in output**
- **Cause:** Missing data in requirement CSVs
- **Solution:**
  - Check for empty rows or missing Building column
  - Ensure material counts are numbers (not text)
  - Verify BuildingType is exactly "PRODUCTION" or "HABITATION"

### Calculation Issues

**Problem: Costs seem too high/low**
- **Cause:** Runs P/D normalization or wrong material counts
- **Solution:**
  - Check Runs P/D value for that recipe (in recipes.csv)
  - Remember: WfCst and Deprec are per-batch, not per-day
  - Verify material counts in requirements match game values
  - Example: If recipe has 0.5 Runs P/D, costs will be 2× daily cost

**Problem: AllBuildCst is different for same building**
- **Cause:** Bug in calculation logic
- **Solution:** All recipes for same building MUST have identical AllBuildCst
- **Check:** `grep "^AAF," recipes-dynamic.csv | cut -d',' -f7 | sort -u` (should show one value)

**Problem: Depreciation is zero for production buildings**
- **Cause:** BuildingType not set to "PRODUCTION" in build-requirements.csv
- **Solution:** Check BuildingType column is exactly "PRODUCTION" (case-sensitive)

### Workflow Issues

**Problem: Workflow fails to upload to GCS**
- **Cause:** GCP credentials or permissions issue
- **Solution:**
  - Verify `GCP_SA_KEY` secret is set in GitHub repo settings
  - Check service account has write permissions to bucket
  - Existing workflows use same credentials, so this is unlikely

**Problem: Test mode uploads overwrite production files**
- **Cause:** Running workflow from `main` branch
- **Solution:** Always test from a feature branch (e.g., `dynamic-cost`)
- **Check logs:** Should see "TEST MODE" warnings if on non-main branch

**Problem: Calculation takes too long or times out**
- **Cause:** Too many buildings or complex calculations
- **Solution:**
  - Check workflow timeout settings (default: 2 hours)
  - Review script performance with local testing first
  - Consider reducing number of buildings in test run

### Validation Commands

```bash
# Check CSV format (should show clean columns)
head -3 public/data/workforce-requirements.csv

# Count buildings in each file (should match)
grep -v "^Building," public/data/workforce-requirements.csv | wc -l
grep -v "^Building," public/data/build-requirements.csv | wc -l

# Verify no duplicate buildings
cut -d',' -f1 public/data/workforce-requirements.csv | sort | uniq -d

# Check for invalid BuildingType values
grep -v "PRODUCTION\|HABITATION\|BuildingType" public/data/build-requirements.csv
```

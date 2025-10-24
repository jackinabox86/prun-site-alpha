# Dynamic Cost Calculation System

This document explains how dynamic workforce, depreciation, and build costs are calculated based on current market prices.

## Overview

Previously, `WfCst`, `Deprec`, and `AllBuildCst` in recipes.csv were static values. Now they're dynamically calculated every 30 minutes based on current material prices **for each exchange** (ANT, CIS, ICA, NCC, UNV).

**Key Feature:** Costs are calculated separately for each exchange region because material prices vary significantly across exchanges (±30%+), ensuring users see accurate costs matching their selected exchange.

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

### Building-Level Daily Costs (per exchange)

For each exchange (ANT, CIS, ICA, NCC, UNV):
- **Daily Workforce Cost** = Σ(workforce material requirements × exchange-specific AskPrice)
- **Total Build Cost** = Σ(build material requirements × exchange-specific AskPrice)
- **Daily Depreciation** = (Total Build Cost ÷ 180 days) if PRODUCTION building, else 0

### Recipe-Level Costs (in recipes.csv)

Costs are stored as exchange-specific columns:
- **WfCst-{EXCHANGE}** = Daily Workforce Cost ÷ Runs P/D (per batch cost)
- **Deprec-{EXCHANGE}** = Daily Depreciation ÷ Runs P/D (per batch cost)
- **AllBuildCst-{EXCHANGE}** = Total Build Cost (NOT divided - one-time total)

Where `{EXCHANGE}` is one of: ANT, CIS, ICA, NCC, UNV

### Example

AAF building on ICA exchange:
- Daily workforce cost: 10,000 ICA (calculated using ICA-AskPrice for DW, PE, RAT)
- Total build cost: 1,468,840 ICA (calculated using ICA-AskPrice for AEF, BSE, MCG, etc.)
- Recipe with 0.8 runs/day:
  - WfCst-ICA = 10,000 ÷ 0.8 = 12,500 per batch
  - Deprec-ICA = (1,468,840 ÷ 180) ÷ 0.8 = 10,200 per batch
  - AllBuildCst-ICA = 1,468,840

**Note:** Same AAF recipe would have different costs on ANT exchange if material prices differ.

### CSV Structure

Each recipe row now contains 15 cost columns (3 costs × 5 exchanges):
```
Building, Ticker, Runs P/D,
WfCst-ANT, Deprec-ANT, AllBuildCst-ANT,
WfCst-CIS, Deprec-CIS, AllBuildCst-CIS,
WfCst-ICA, Deprec-ICA, AllBuildCst-ICA,
WfCst-NCC, Deprec-NCC, AllBuildCst-NCC,
WfCst-UNV, Deprec-UNV, AllBuildCst-UNV,
[other recipe columns...]
```

## Data Files

### Input Files (on GCS)

1. **workforce-requirements.csv** - Material needs for workforce per building
   - Location: `gs://prun-site-alpha-bucket/workforce-requirements.csv`
   - Structure: Building, Input1MAT, Input1CNT, ..., Input5MAT, Input5CNT
   - Update: Manually when game changes (rarely)

2. **build-requirements.csv** - Construction materials per production building
   - Location: `gs://prun-site-alpha-bucket/build-requirements.csv`
   - Structure: Building, BuildingType, Input1MAT, Input1CNT, ..., Input10MAT, Input10CNT
   - BuildingType: "PRODUCTION" (only production buildings)
   - Contains only PRODUCTION building materials (no HABITATION rows)
   - Update: Manually when game changes (rarely)

   **Example:**
   ```csv
   Building,BuildingType,Input1MAT,Input1CNT,...
   AAF,PRODUCTION,AEF,10,BSE,20,MCG,8,...
   AML,PRODUCTION,AEF,8,BSE,15,MCG,6,...
   ```

3. **habitation-building-costs.csv** - Construction materials per habitation building type
   - Location: `gs://prun-site-alpha-bucket/habitation-building-costs.csv`
   - Structure: HabitationType, Input1MAT, Input1CNT, ..., Input10MAT, Input10CNT
   - Lists materials needed to construct ONE building of each habitation type
   - Update: Manually when game changes (rarely)

   **Example:**
   ```csv
   HabitationType,Input1MAT,Input1CNT,...
   HB1,AEF,5,BSE,10,...
   HBB,AEF,8,BSE,15,MCG,3,...
   HBL,AEF,12,BSE,20,MCG,5,...
   HBM,AEF,15,BSE,25,MCG,8,...
   HBC,AEF,20,BSE,30,MCG,12,...
   ```

4. **production-habitation-requirements.csv** - Habitation needs per production building
   - Location: `gs://prun-site-alpha-bucket/production-habitation-requirements.csv`
   - Structure: ProductionBuilding, FactorAmount, Hab1Type, Hab1Qty, Hab2Type, Hab2Qty, ..., Hab5Type, Hab5Qty
   - Maps each production building to required habitation buildings (quantities can be fractional)
   - **FactorAmount**: Divisor applied to total habitation costs (e.g., 100 if habitations serve 100 production buildings)
   - Update: Manually when game changes or when production/habitation ratios change

   **Example:**
   ```csv
   ProductionBuilding,FactorAmount,Hab1Type,Hab1Qty,Hab2Type,Hab2Qty,...
   AAF,100,HBM,0.5,HBC,1.2,...
   AML,100,HBB,0.8,HBM,0.3,...
   APF,100,HB1,1.5,HBB,0.6,HBL,0.2
   ```
   - Quantities represent the number (or fraction) of each habitation building type needed
   - **Calculation**: Habitation cost = [Σ(habitation building cost × quantity)] / FactorAmount
   - Total build cost = Production building cost + Habitation cost (after dividing by FactorAmount)

5. **recipes.csv** (base) - Authoritative recipe data
   - Location: `gs://prun-site-alpha-bucket/recipes.csv`
   - This is the base file that gets dynamically updated
   - Backup available as `recipes-base.csv`

6. **prices.csv** - Current market prices (auto-updated every 30 min)
   - Location: `gs://prun-site-alpha-bucket/prices.csv`

### Output Files

- **recipes.csv** - Recipes with dynamic costs (overwrites base)
  - Generated every 30 minutes by GitHub Actions
  - Contains exchange-specific cost columns (WfCst-{EXCHANGE}, Deprec-{EXCHANGE}, AllBuildCst-{EXCHANGE})
  - Used by entire application

- **building-costs.csv** - Individual building costs per exchange
  - Generated alongside recipes.csv every 30 minutes
  - Structure: Building, BuildingType, ANT-Cost, CIS-Cost, ICA-Cost, NCC-Cost, UNV-Cost
  - Shows cost of ONE building of each type (production and habitation) across all exchanges
  - Useful for transparency, debugging, and understanding cost breakdowns
  - Location: `gs://prun-site-alpha-bucket/building-costs.csv`

## Scripts

### `scripts/calculate-dynamic-costs.ts`

Main calculation script with two-phase architecture:

**Phase 1: Calculate ALL building costs per exchange**
1. Fetches all required CSVs from GCS
2. Builds lookup maps for prices, workforce, build requirements, habitation costs, and habitation requirements
3. Calculates production building costs for all 5 exchanges (ANT, CIS, ICA, NCC, UNV)
4. Calculates habitation building costs for all 5 exchanges
5. Stores all building costs in `buildingCostsMap`
6. Exports `public/data/building-costs.csv`

**Phase 2: Calculate recipe costs with habitation**
1. For each production building:
   - Gets production building cost from buildingCostsMap (exchange-specific)
   - Calculates habitation cost: [Σ(habitation building cost × quantity)] / FactorAmount per exchange
   - Total build cost = production + habitation (both exchange-specific)
   - Depreciation = production cost only ÷ 180 days
2. Populates 15 cost columns per recipe (3 costs × 5 exchanges)
3. Outputs `public/data/recipes-dynamic.csv`

**Key Features:**
- **Exchange-specific pricing**: All costs calculated separately for ANT, CIS, ICA, NCC, UNV
- **Modular habitation costs**: Habitation buildings calculated once, reused for all production buildings
- **Fractional quantities**: Supports fractional habitation requirements (e.g., 0.5 HBM, 1.2 HBC)
- **FactorAmount scaling**: Habitation costs divided by FactorAmount to account for shared/distributed costs
- **Transparent output**: building-costs.csv shows all intermediate building costs
- **Depreciation**: Only production buildings depreciate (habitation costs included in build cost but not depreciated)

**Environment Variables:**
- `GCS_RECIPES_URL` - Base recipes CSV
- `GCS_PRICES_URL` - Current prices CSV
- `GCS_WORKFORCE_URL` - Workforce requirements CSV
- `GCS_BUILD_URL` - Build requirements CSV (production buildings only)
- `GCS_HABITATION_COSTS_URL` - Habitation building costs CSV
- `GCS_PRODUCTION_HAB_REQ_URL` - Production-habitation requirements mapping CSV

**Run locally:**
```bash
npm run calculate-costs
```

## GitHub Actions Workflow

### `.github/workflows/refresh-prices.yml`

Updated workflow that runs every 30 minutes:

1. Fetch prices from FNAR and PrunPlanner APIs
2. Merge price data → `prices.csv`
3. **Calculate dynamic costs** → `recipes-dynamic.csv` + `building-costs.csv`
4. Upload all three files to GCS (prices, recipes, building-costs)
5. Best-recipes workflow runs 10 min later (unchanged)

**Output files:**
- `prices.csv` (or `prices-test.csv` for non-main branches)
- `recipes.csv` (or `recipes-test.csv` for non-main branches)
- `building-costs.csv` (or `building-costs-test.csv` for non-main branches)

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
- `public/data/habitation-building-costs.csv`
- `public/data/production-habitation-requirements.csv`

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
AML,PRODUCTION,AEF,8,BSE,15,MCG,6,...
```

`habitation-building-costs.csv`:
```csv
HabitationType,Input1MAT,Input1CNT,Input2MAT,Input2CNT,...,Input10MAT,Input10CNT
HB1,AEF,5,BSE,10,...
HBB,AEF,8,BSE,15,MCG,3,...
HBL,AEF,12,BSE,20,MCG,5,...
HBM,AEF,15,BSE,25,MCG,8,...
HBC,AEF,20,BSE,30,MCG,12,...
```

`production-habitation-requirements.csv`:
```csv
ProductionBuilding,FactorAmount,Hab1Type,Hab1Qty,Hab2Type,Hab2Qty,...,Hab5Type,Hab5Qty
AAF,100,HBM,0.5,HBC,1.2,...
AML,100,HBB,0.8,HBM,0.3,...
APF,100,HB1,1.5,HBB,0.6,HBL,0.2
```

**Important notes:**
- Include ALL buildings that appear in recipes.csv
- **Production buildings have ONLY ONE row** in build-requirements.csv (PRODUCTION type only)
- Habitation costs are calculated separately and dynamically combined
- BuildingType must be "PRODUCTION" in build-requirements.csv
- Habitation building quantities can be fractional (e.g., 0.5, 1.2)
- **FactorAmount** is a divisor applied to total habitation costs (defaults to 1 if not specified)
- Use empty cells (,,,) for unused input slots
- Material tickers must match exactly with prices.csv

#### Step 2: Upload Requirements to GCS

After populating the CSVs, upload them:

```bash
# Upload workforce requirements
gsutil -h "Cache-Control:public, max-age=86400" \
       cp public/data/workforce-requirements.csv \
       gs://prun-site-alpha-bucket/workforce-requirements.csv

# Upload build requirements (production buildings only)
gsutil -h "Cache-Control:public, max-age=86400" \
       cp public/data/build-requirements.csv \
       gs://prun-site-alpha-bucket/build-requirements.csv

# Upload habitation building costs
gsutil -h "Cache-Control:public, max-age=86400" \
       cp public/data/habitation-building-costs.csv \
       gs://prun-site-alpha-bucket/habitation-building-costs.csv

# Upload production-habitation requirements
gsutil -h "Cache-Control:public, max-age=86400" \
       cp public/data/production-habitation-requirements.csv \
       gs://prun-site-alpha-bucket/production-habitation-requirements.csv
```

**Verify uploads:**
```bash
gsutil ls -lh gs://prun-site-alpha-bucket/workforce-requirements.csv
gsutil ls -lh gs://prun-site-alpha-bucket/build-requirements.csv
gsutil ls -lh gs://prun-site-alpha-bucket/habitation-building-costs.csv
gsutil ls -lh gs://prun-site-alpha-bucket/production-habitation-requirements.csv
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

**All these components automatically use the exchange-specific dynamic costs:**

- ✅ Main production analysis (`src/server/report.ts`)
  - Uses `exchange` parameter to select correct cost columns
- ✅ Best recipes calculation (`src/server/bestRecipes.ts`)
  - Calculates best recipes per exchange using exchange-specific costs
- ✅ Profit per area calculations (`src/core/engine.ts`)
  - Helper function `getCostColumnNames(exchange)` maps to correct columns
- ✅ ROI analysis (`src/core/roi.ts`)
  - Uses costs from selected exchange
- ✅ Input payback calculations (`src/core/inputPayback.ts`)
  - Uses costs from selected exchange
- ✅ All scenario comparisons
- ✅ Every API endpoint

**Code Changes Made:**
- Added `getCostColumnNames(exchange)` helper function in `engine.ts` and `bestRecipes.ts`
- Updated all `headers.indexOf("WfCst")` to `headers.indexOf(costCols.wfCst)` (and similar for Deprec, AllBuildCst)
- Application now reads exchange-specific columns based on user's exchange selection

## Files Modified

### New Files
- `public/data/workforce-requirements.csv` - Material requirements for workforce per building
- `public/data/build-requirements.csv` - Construction materials per production building (PRODUCTION rows only)
- `public/data/habitation-building-costs.csv` - Construction materials for ONE building of each habitation type
- `public/data/production-habitation-requirements.csv` - Habitation needs (with fractional quantities and FactorAmount) per production building
- `public/data/building-costs.csv` - (OUTPUT) Individual building costs per exchange for all buildings

### Updated Files
- `scripts/calculate-dynamic-costs.ts` - Two-phase calculation with habitation cost system
  - Added `Exchange` type and `EXCHANGE_PREFIXES` mapping
  - Added interfaces for `HabitationBuildingCost` and `ProductionHabitationRequirement`
  - Added GCS URLs for new CSV files
  - **Phase 1**: Calculate all building costs (production + habitation) per exchange
  - **Phase 2**: Calculate recipe costs using pre-calculated building costs + habitation requirements
  - Exports `building-costs.csv` showing cost of ONE building per type per exchange
  - Supports fractional habitation quantities (e.g., 0.5 HBM, 1.2 HBC)
  - Applies FactorAmount divisor to habitation costs for proper per-building allocation
  - All costs calculated per exchange (ANT, CIS, ICA, NCC, UNV)
- `.github/workflows/refresh-prices.yml` - Added new CSV environment variables and building-costs.csv upload
  - Added `GCS_HABITATION_COSTS_URL` and `GCS_PRODUCTION_HAB_REQ_URL` environment variables
  - Uploads `building-costs.csv` to GCS alongside recipes and prices
- `src/core/engine.ts` - Reads exchange-specific cost columns (no changes in this update)
  - Added `getCostColumnNames(exchange)` helper (from previous update)
  - Updated all cost column lookups to use exchange-specific names (from previous update)
- `src/server/bestRecipes.ts` - Reads exchange-specific cost columns (no changes in this update)
  - Added `getCostColumnNames(exchange)` helper (from previous update)
  - Updated cost column lookups (from previous update)
- `package.json` - Added "calculate-costs" npm script (from previous update)
- `DYNAMIC_COSTS_README.md` - Updated documentation for habitation cost system and exchange-specific calculations

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
- **Solution:**
  - Check BuildingType column is exactly "PRODUCTION" (case-sensitive)
  - Ensure production buildings have PRODUCTION row in build-requirements.csv

**Problem: Build cost seems too low (missing habitation buildings)**
- **Cause:** Missing or incomplete data in production-habitation-requirements.csv
- **Solution:**
  - Check that production building exists in production-habitation-requirements.csv
  - Verify habitation quantities are populated (Hab1Type, Hab1Qty, etc.)
  - Ensure habitation types (HB1, HBB, etc.) exist in habitation-building-costs.csv
  - Check console output for "Habitation type X not found" warnings

**Problem: "Habitation type X not found in building costs map" warning**
- **Cause:** Habitation type referenced in production-habitation-requirements.csv doesn't exist in habitation-building-costs.csv
- **Solution:**
  - Add missing habitation type to habitation-building-costs.csv
  - Verify spelling/capitalization matches exactly between the two CSVs
  - Check that habitation-building-costs.csv was uploaded to GCS

**Problem: Fractional habitation quantities not working**
- **Cause:** Quantities stored as strings instead of numbers
- **Solution:**
  - Ensure quantities in production-habitation-requirements.csv are numeric values (0.5, 1.2, etc.)
  - Don't use quotes around numbers in CSV
  - Script uses Number() conversion, so "0.5" should work, but better to use raw numbers

**Problem: Habitation costs seem too high or not properly scaled**
- **Cause:** Missing or incorrect FactorAmount value
- **Solution:**
  - Verify FactorAmount column exists in production-habitation-requirements.csv
  - Ensure FactorAmount is a positive number (e.g., 100)
  - FactorAmount defaults to 1 if missing, which means no division
  - Formula: Habitation cost = [Σ(hab building cost × qty)] / FactorAmount
  - Example: If total hab cost is 10,000 and FactorAmount is 100, final cost is 100 per production building

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

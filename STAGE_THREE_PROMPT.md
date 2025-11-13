# Stage Three: Extraction-Enabled Best Recipes Generation

## Overview

Stage Three creates extraction-specific best recipes files that properly account for planet-specific extraction recipes. This resolves the bestMap pruning issue identified in Stage Two, where the engine prefers pre-computed scenarios that don't include extraction options.

## Current Limitation (Stage Two)

When extraction mode is enabled:
- Extraction recipes are merged into the recipeMap ✓
- BUT bestMap still uses standard best-recipes (e.g., `best-recipes-ANT-Ask.json`)
- These best recipes assume raw materials are BOUGHT, not extracted
- Expected scenarios like "Buy HAL | Buy LIO" don't match extraction scenarios
- Result: Extraction options get pruned or deprioritized even when more profitable

**Example**: POW production
- Standard bestMap expects: "Buy LI" or "Make LI [Buy HAL | Buy LIO]"
- Extraction scenario: "Make LI [Buy HAL | Make LIO [Extract from Romulus]]"
- Engine prefers scenario matching over profit → extraction options excluded

## Stage Three Goals

1. **Generate extraction-specific best recipes** for each exchange and price mode
2. **Modify refresh-best-recipes GitHub action** to create both standard and extraction variants
3. **Update engine to load correct best recipes** based on extraction mode setting
4. **Make extensible** for CIS/ICA/NCC/UNV when their expanded recipes are added

## Implementation Requirements

### 1. New Best Recipes Files to Generate

For each exchange that has expanded recipes, create variants:

**Current (Standard):**
- `best-recipes-ANT-Ask.json`
- `best-recipes-ANT-Bid.json`
- `best-recipes-CIS-Ask.json`
- etc.

**New (Extraction):**
- `best-recipes-ANT-Ask-Extraction.json`
- `best-recipes-ANT-Bid-Extraction.json`
- `best-recipes-CIS-Ask-Extraction.json` (when CIS expanded recipes exist)
- etc.

**Naming convention:** `best-recipes-{EXCHANGE}-{PRICETYPE}-Extraction.json`

### 2. Modify GitHub Action: refresh-best-recipes.yml

**Current workflow:**
1. Runs `npm run generate-best-recipes` (calls `scripts/generate-best-recipes.ts`)
2. Generates standard best recipes for ANT/CIS/ICA/NCC/UNV
3. Uploads to GCS

**New workflow:**
1. Generate standard best recipes (keep existing)
2. **For each exchange with expanded recipes:**
   - Run best recipe generation WITH extraction mode enabled
   - Include expanded recipes in the analysis
   - Output to `best-recipes-{EXCHANGE}-{PRICETYPE}-Extraction.json`
3. Upload both standard and extraction variants to GCS

**Key questions:**
- Does `generate-best-recipes.ts` need an `--extraction` flag?
- Should it automatically detect which exchanges have expanded recipes?
- How to handle the increased computation time (ANT only initially, but scales to 5 exchanges)?

### 3. Update Best Recipe Loading Logic

**Files to modify:**
- `src/server/cachedBestRecipes.ts` - cached best recipe loader
- `src/server/report.ts` - buildReport function

**Current logic:**
```typescript
const { bestMap } = await cachedBestRecipes.getBestRecipes(priceSource, exchange, 'bid');
```

**New logic:**
```typescript
// Determine which best recipes file to use
const bestRecipesVariant = extractionMode ? 'extraction' : 'standard';
const { bestMap } = await cachedBestRecipes.getBestRecipes(
  priceSource,
  exchange,
  'bid',
  bestRecipesVariant  // NEW parameter
);
```

**cachedBestRecipes.ts changes:**
- Add variant parameter ('standard' | 'extraction')
- Load appropriate file based on variant
- Handle fallback if extraction file doesn't exist for exchange
- Cache both variants separately

### 4. Extension Strategy for Future Exchanges

**When adding CIS expanded recipes:**
1. Upload `CIS-expandedrecipes.csv` and `CIS-extractionplanets.csv` to GCS
2. `calculate-expanded-costs.ts` automatically processes it (already exchange-agnostic)
3. GitHub action automatically generates `best-recipes-CIS-*-Extraction.json`
4. Extraction mode button becomes enabled for CIS in UI
5. No code changes required!

**Checklist for each new exchange:**
- [ ] Upload `{EXCHANGE}-expandedrecipes.csv` to GCS static folder
- [ ] Upload `{EXCHANGE}-extractionplanets.csv` to GCS static folder
- [ ] Verify `calculate-expanded-costs.ts` processes it (should be automatic)
- [ ] Verify `refresh-best-recipes` generates extraction variants
- [ ] Update UI to enable extraction mode button for that exchange

### 5. Testing Requirements

After implementation, verify:

**For ANT with extraction mode ON:**
1. Loads `best-recipes-ANT-Ask-Extraction.json` ✓
2. bestMap includes extraction-based scenarios ✓
3. POW → LI → LIO chain properly considers extraction ✓
4. Scenarios like "Make LI [Buy HAL | Make LIO [Extract from Romulus]]" appear ✓
5. Engine selects most profitable option including extraction paths ✓

**For other exchanges:**
1. Without expanded recipes: Falls back to standard best recipes ✓
2. With expanded recipes: Uses extraction best recipes when mode ON ✓

**Performance:**
1. Best recipe generation time acceptable (may be ~2x slower for extraction variant)
2. Runtime analysis performance unchanged (uses cached best recipes)
3. Both standard and extraction variants cached separately

## Technical Design Questions

1. **Best recipe generation script:**
   - Should `generate-best-recipes.ts` have a `--mode=extraction` flag?
   - Or should it automatically generate both variants in one run?
   - How to pass extraction mode through to the analysis engine?

2. **File naming:**
   - Is `-Extraction` suffix clear enough?
   - Alternative: `best-recipes-extraction-ANT-Ask.json`?

3. **Fallback behavior:**
   - If `best-recipes-ANT-Ask-Extraction.json` doesn't exist, use standard?
   - Or throw error to force generation?

4. **Cache invalidation:**
   - Do standard and extraction best recipes expire together?
   - Or track separately (extraction recipes change less frequently)?

5. **Workflow optimization:**
   - Generate extraction best recipes only for exchanges with expanded recipes?
   - Run in parallel to reduce workflow time?

## Expected Outcome

After Stage Three:
- ✅ Extraction mode fully functional for all depth levels
- ✅ bestMap pruning works correctly with extraction scenarios
- ✅ No performance workarounds needed
- ✅ Easy to add new exchanges (just upload CSV files)
- ✅ Clean, maintainable codebase without technical debt

## Related Files

- `scripts/generate-best-recipes.ts` - Best recipe generation script
- `.github/workflows/refresh-best-recipes.yml` - Best recipe workflow
- `src/server/cachedBestRecipes.ts` - Best recipe caching/loading
- `src/server/report.ts` - Uses best recipes for analysis
- `src/lib/config.ts` - Best recipe file paths

## Notes

- Stage Two works for direct extraction (analyzing AMM, F, AR, etc.)
- Stage Two has limitations for deep production chains due to bestMap pruning
- Stage Three resolves these limitations by making bestMap extraction-aware
- No Stage Two code needs to be removed - it's all foundation for Stage Three

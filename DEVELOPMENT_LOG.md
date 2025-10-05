# Development Log

## Session: 2025-10-05 - ROI Broad & Cumulative Metrics Implementation

### Overview
This session focused on implementing cumulative metrics for the production chain analysis, adding ROI (broad) calculations, and cleaning up obsolete code. The main theme was treating child production stages' costs and buffers as cumulative values that roll up to the parent stage.

---

### 1. Branch Management & Initial Setup

**Branch: `ROI-broad`**
- Created from main branch
- Merged latest changes from origin/main
- Added Scenario field to info section header (moved between Best P/A and Mode)

---

### 2. Cumulative Build Cost Implementation

**Problem:** Build costs were only tracked at individual stages, not cumulatively across the production chain.

**Solution:** Implemented cumulative build cost tracking similar to how child area is handled.

**Changes Made:**

#### Type Updates (`src/types.ts`)
```typescript
export interface ScenarioRowsResult {
  // ... existing fields
  subtreeBuildCost: number;           // Total build cost at this node's capacity
  subtreeBuildCostNeeded: number;     // Build cost scaled to parent's demand
}
```

#### Engine Implementation (`src/core/engine.ts`)
- Added `childrenBuildCostNeededSum` tracking in child processing loop
- Implemented scaling calculations:
  ```typescript
  const selfBuildCost = option.buildCost || 0;
  const scaledSelfBuildCostNeeded = selfBuildCost * runsPerDayRequiredHere;

  const childrenBuildCostAtCapacity =
    runsPerDayRequiredHere > 0
      ? (childrenBuildCostNeededSum / runsPerDayRequiredHere) * (option.runsPerDay || 0)
      : 0;

  const totalBuildCostForOwn = selfBuildCost + childrenBuildCostAtCapacity;
  const totalBuildCostNeededForParent = scaledSelfBuildCostNeeded + childrenBuildCostNeededSum;
  ```

#### API & Display (`src/server/report.ts`, `app/components/ReportClient.tsx`)
- Added `totalBuildCost` to WithMetrics type
- Exposed via API for both best scenario and top20
- Displayed in info section below ROI (narrow)

---

### 3. ROI (Broad) Implementation

**Problem:** ROI (narrow) only considers self build cost. Need metric for total chain payback.

**Solution:** Created ROI (broad) that uses cumulative build cost from entire production chain.

**Changes Made:**

#### New Calculation (`src/core/roi.ts`)
```typescript
export function computeRoiBroad(
  totalBuildCost: number,
  baseProfitPerDay: number
): {
  broadDays: number | null;
  totalBuildCost: number;
  basis: "baseProfitPerDay";
}
```

**Formula:** `ROI (broad) = totalBuildCost / baseProfitPerDay`

#### Integration
- Added to report calculations (`src/server/report.ts`)
- Added `roiBroadDays` to WithMetrics type
- Displayed in info section after ROI (narrow)
- Added ROI (broad) column to Top20 table

#### Display Structure
```
ROI (narrow): X days     <- payback for self build cost only
Build cost: ₳X           <- self build cost
ROI (broad): Y days      <- payback for total chain build cost
Total build cost: ₳Y     <- cumulative build cost
```

---

### 4. Info Section in Top20 Table

**Enhancement:** Added expandable info sections to Top20 table rows.

**Implementation:**
- When user expands a row, shows Sankey chart followed by info section
- Info section displays same metrics as main best scenario:
  - Scenario
  - Base profit/day
  - Total Area/Day
  - ROI (narrow) / Build cost
  - ROI (broad) / Total build cost
  - Profit P/A

**File:** `app/components/Top20Table.tsx`

---

### 5. Scaling Information Enhancement

**Problem:** Scaling data (runs/day required, demand units/day) was calculated in both engine and Sankey chart.

**Solution:** Single source of truth - calculate once in engine, store on objects, use everywhere.

#### Type Updates (`src/types.ts`)
```typescript
export interface MadeInputDetail {
  // ... existing fields
  childRunsPerDayRequired?: number;  // runs/day needed from child
  childDemandUnitsPerDay?: number;   // units/day needed from child
}

export interface ScenarioRowsResult {
  // ... existing fields
  runsPerDayRequired: number;
  demandUnitsPerDay: number;
}
```

#### Engine Storage (`src/core/engine.ts`)
```typescript
// Store the calculated scaling values on the input detail
item.childRunsPerDayRequired = child.runsPerDayRequired;
item.childDemandUnitsPerDay = child.demandUnitsPerDay;
```

#### Sankey Display (`app/components/BestScenarioSankey.tsx`)
- Uses pre-calculated values from `inp.childRunsPerDayRequired` and `inp.childDemandUnitsPerDay`
- Falls back to calculation only if unavailable (backward compatibility)
- Displays in child/grandchild node tooltips:
  ```
  Runs/day required: X
  Demand units/day: Y
  ```

---

### 6. Code Cleanup - Removed Obsolete Rows System

**Problem:** Human-readable text rows were no longer used. System now uses:
- Info sections for structured metrics
- Sankey charts for visualization
- Top20 table for tabular data

**Removed:**
- `rows` array from `ScenarioRowsResult`
- All row-building logic from `buildScenarioRows()`
- `expand` and `includeRows` parameters from API
- Related state variables from ReportClient
- Unused imports (`computeRoiNarrow`, `computeInputPayback` from engine)

**Files Cleaned:**
- `src/types.ts`
- `src/core/engine.ts`
- `src/server/report.ts`
- `app/api/report/route.ts`
- `app/components/ReportClient.tsx`

**Benefits:**
- Reduced memory usage
- Eliminated redundant processing
- Simplified codebase
- Improved maintainability

---

### 7. Cumulative Input Buffer Implementation

**Problem:** Input buffer (7-day buffer of inputs + workforce) only tracked at individual stages.

**Solution:** Implemented cumulative input buffer tracking, parallel to build cost implementation.

**Changes Made:**

#### Type Updates (`src/types.ts`)
```typescript
export interface ScenarioRowsResult {
  // ... existing fields
  subtreeInputBuffer7: number;         // Total input buffer at this node's capacity
  subtreeInputBuffer7Needed: number;   // Input buffer scaled to parent's demand
}
```

#### Engine Implementation (`src/core/engine.ts`)
Similar pattern to build cost:
```typescript
const selfInputBuffer7 = option.inputBuffer7 || 0;
const scaledSelfInputBuffer7Needed = selfInputBuffer7 * runsPerDayRequiredHere;

const childrenInputBuffer7AtCapacity =
  runsPerDayRequiredHere > 0
    ? (childrenInputBuffer7NeededSum / runsPerDayRequiredHere) * (option.runsPerDay || 0)
    : 0;

const totalInputBuffer7ForOwn = selfInputBuffer7 + childrenInputBuffer7AtCapacity;
const totalInputBuffer7NeededForParent = scaledSelfInputBuffer7Needed + childrenInputBuffer7NeededSum;
```

#### API Integration
- Added `totalInputBuffer7` to WithMetrics type
- Included in both best scenario and top20 calculations
- Available for future display/use

**Note:** Narrow input buffer (`option.inputBuffer7` - self only) preserved and continues to display separately.

---

### Architecture Patterns Established

#### 1. Cumulative Metric Pattern
For any stage-level metric that should accumulate up the production chain:

1. **Calculate self value** (already on MakeOption)
2. **Scale to demand:** `selfValue * runsPerDayRequiredHere`
3. **Sum children:** Track in loop processing children
4. **Scale children to capacity:** `(childrenSum / runsPerDayRequiredHere) * runsPerDay`
5. **Calculate totals:**
   - `totalForOwn = self + childrenAtCapacity` (for this stage's calculations)
   - `totalNeededForParent = scaledSelf + childrenSum` (to pass up)
6. **Store in ScenarioRowsResult** as `subtreeX` and `subtreeXNeeded`

Applied to:
- Area (existing)
- Build cost (added today)
- Input buffer (added today)

#### 2. Single Source of Truth Pattern
- Calculate complex values once in engine
- Store on data structures
- Consume in UI components
- Fallback calculations only for backward compatibility

Applied to:
- Scaling information (runs/day required, demand units/day)
- All cumulative metrics

---

### Files Modified Summary

**Core Engine & Types:**
- `src/types.ts` - Added cumulative metric fields, scaling info
- `src/core/engine.ts` - Implemented cumulative calculations, removed rows logic
- `src/core/roi.ts` - Added computeRoiBroad function

**API Layer:**
- `src/server/report.ts` - Added metrics to WithMetrics type, removed rows logic
- `app/api/report/route.ts` - Removed unused parameters

**UI Components:**
- `app/components/ReportClient.tsx` - Added ROI broad & build cost display, removed unused state
- `app/components/Top20Table.tsx` - Added info section, ROI broad column
- `app/components/BestScenarioSankey.tsx` - Used pre-calculated scaling values, added to tooltips

---

### Key Metrics Now Available

**Per Stage (Narrow):**
- Build cost (self only)
- Input buffer (self only)
- ROI (narrow) - self build cost / base profit per day

**Cumulative (Broad):**
- Total build cost (self + all children, proportional)
- Total input buffer (self + all children, proportional)
- ROI (broad) - total build cost / base profit per day
- Total area per day (existing)

**Scaling Information:**
- Runs per day required (for each child relative to parent)
- Demand units per day (for each child relative to parent)

---

### Future Enhancement Opportunities

1. **ROI using total input buffer** - Could calculate another ROI variant using cumulative input buffer
2. **Visualize cumulative metrics** - Could show cumulative vs narrow metrics in charts
3. **Filtering/sorting by cumulative metrics** - Top20 table could sort by ROI (broad) or total build cost
4. **Export cumulative data** - CSV/JSON export of full chain metrics

---

### Testing Recommendations

1. Verify cumulative calculations match expected values for multi-level production chains
2. Confirm ROI (broad) > ROI (narrow) when children exist
3. Validate scaling information matches actual production requirements
4. Check that narrow metrics still display correctly alongside cumulative ones
5. Test Top20 table expansion shows complete info for each scenario

---

### Branch Status
- Branch: `info-section-in-top-table` (final working branch)
- Ready for review and potential merge to main
- All changes tested and functional

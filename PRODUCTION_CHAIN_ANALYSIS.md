# Production Chain Analysis: Technical Documentation

This document explains how the production chain analysis engine (`src/core/engine.ts`) evaluates optimal production strategies for any given ticker in the game.

## Table of Contents

1. [Assumptions](#assumptions)
2. [Core Concepts](#core-concepts)
3. [Profit Calculation](#profit-calculation)
4. [Input Analysis and Scenario Branching](#input-analysis-and-scenario-branching)
5. [Recursive Chain Analysis](#recursive-chain-analysis)
6. [Normalization: Profit Per Area Per Day](#normalization-profit-per-area-per-day)
7. [Opportunity Cost](#opportunity-cost)
8. [Scenario Selection and Pruning](#scenario-selection-and-pruning)
9. [Examples](#examples)

---

## Assumptions

The production chain analysis is built on several key assumptions about how production operates:

### Production Efficiency
- Each building runs at **maximum efficiency** with 5 experts assigned
- All buildings benefit from an **aligned COGC (Company Operating Costs Coefficient)** of 160.5%
- These efficiency assumptions are baked into the workforce and depreciation costs in the recipe data

### Base Infrastructure
- Each building is assumed to be on a **PrunPlanner optimal base layout**
- Associated **Habitation Modules** for workforce are accounted for in the base design
- A **Core Module** is included in the infrastructure costs
- The area calculations reflect optimized building placement

### Market and Pricing
- **Prices are available and stable** for all materials in the selected exchange and price mode
- Recipes are skipped if the primary output lacks a price for the selected price type
- Market depth and liquidity are not considered (assumes unlimited buy/sell at listed prices)
- **No transaction costs, fees, or taxes** are included
- **Transportation costs** between planets/stations are not included

### Operational Assumptions
- Buildings run **continuously (24/7)** at their stated `runsPerDay` rate
- **All inputs are available** when needed (no stockout or supply chain interruptions)
- Production runs complete exactly on schedule with no delays
- Byproduct outputs can be sold immediately at market price if not used internally

### Data Accuracy
- Recipe data (inputs, outputs, production times) is accurate and reflects current game state
- Building requirements, workforce costs, and depreciation are correctly captured per exchange
- Price data represents true market conditions at the time of analysis

### Simplifications
- **No inventory holding costs** beyond the calculated 7-day input buffer
- **No consideration of market impact** (buying/selling large quantities doesn't move prices)
- **Recipe selection is static** (doesn't account for expertise progression or tech unlocks)
- **No pioneer-specific bonuses** or penalties are modeled

---

## Core Concepts

### Tickers and Recipes

- A **ticker** (e.g., `C`, `GRN`, `RAT`) represents a material or product in the game
- Each ticker can be produced using one or more **recipes**
- Each recipe specifies:
  - **Inputs**: Up to 10 input materials with quantities
  - **Outputs**: Up to 10 output materials (first is primary, rest are byproducts)
  - **Building**: The structure required (e.g., `FP`, `PPF`, `RIG`)
  - **Production costs**: Workforce cost and depreciation per production run
  - **Timing**: Runs per day, area required

### Price Modes

The system supports multiple price sources:
- **Exchange**: `ANT`, `CIS`, `ICA`, `NCC`, or `UNV`
- **Price Type**:
  - `ask` - Asking price (cost to buy)
  - `bid` - Bid price (revenue from selling)
  - `pp7` - 7-day average price
  - `pp30` - 30-day average price

**Key Rule**: When buying inputs, the system uses `ask` prices (except on UNV where the selected price type is used). When valuing outputs, the system uses the selected price type.

---

## Profit Calculation

### Base Profit Formula

For a single recipe execution, profit is calculated as:

```
totalOutputValue = Σ(outputAmount[i] × outputPrice[i])  for all outputs
totalInputCost = Σ(inputAmount[i] × inputPrice[i])  for all inputs
totalProductionCost = totalInputCost + workforceCost + depreciationCost

baseProfit = totalOutputValue - totalProductionCost
```

**Where**:
- `outputPrice[i]` is found using the selected exchange and price type
- `inputPrice[i]` uses `ask` price (or selected type for UNV) from the selected exchange
- `workforceCost` and `depreciationCost` come from the recipe data and vary by exchange

### Per-Output Metrics

```
cogmPerOutput = (totalProductionCost - byproductValue) / output1Amount
baseProfitPerOutput = baseProfit / output1Amount
valuePerOutput = totalOutputValue / output1Amount
```

**Key Insight**: `cogmPerOutput` (Cost of Goods Manufactured) represents the true cost to produce one unit of the primary output, accounting for byproduct credits.

### Daily Metrics

```
profitPerDay = baseProfit × runsPerDay
baseProfitPerDay = baseProfit × runsPerDay
```

---

## Input Analysis and Scenario Branching

### The BUY vs MAKE Decision

For each input material in a recipe, the system faces a fundamental choice:
1. **BUY** the input from the market at market price
2. **MAKE** the input using its own production chain

### Scenario Explosion

With N inputs, each having BUY/MAKE options, there are potentially 2^N scenarios. The system generates all combinations (with intelligent pruning, see below).

### Scenario Naming

Scenarios are named to track the entire decision tree:
- `"Buy C | Make GRN [Buy H2O | Buy NS] | Buy HAL"`
  - Buy carbon directly
  - Make grain using recipe GRN (which itself buys H2O and buys NS)
  - Buy halite directly

The bracketed portions `[...]` contain the child scenario for that MAKE decision.

### Display Scenarios

For UI purposes, nested brackets are stripped to create "display scenarios":
- Full: `"Make C_5 [Make HCP_2 [Buy H2O | Buy NS]] | Make CL [Buy H2O | Buy HAL]"`
- Display: `"Make C_5 | Make CL"`

This simplification makes scenarios easier to read while preserving the top-level decisions.

---

## Recursive Chain Analysis

### Child Option Selection

When considering MAKE for an input, the system must determine the best way to produce that input material. This is done recursively:

```typescript
function bestOptionForTicker(inputTicker, ...):
  1. Look up all recipes that produce inputTicker
  2. For each recipe:
     a. For each of ITS inputs, recursively find bestOptionForTicker
     b. Generate scenarios (BUY vs MAKE best child)
     c. Calculate profit for each scenario
  3. Select the best scenario based on:
     - Exact scenario match from bestMap (if available), OR
     - Highest profit per area (fallback)
  4. Cache and return the chosen option
```

### Cycle Prevention

The system maintains a `seen` set to prevent infinite loops:
- If ticker X requires ticker Y, and ticker Y requires ticker X
- The recursion terminates when a cycle is detected
- Returns `null` for that option

### Memoization

To avoid recalculating the same subtree multiple times, the system caches:
- **BEST_MEMO**: Single best option for each ticker (used for child decisions)
- **ALL_SCENARIOS_MEMO**: Full scenario exploration (used when exploreAllChildScenarios=true)

Cache keys include: `exchange`, `priceType`, `ticker`, and constraint sets (`forceMake`, `forceBuy`, `forceRecipe`, `excludeRecipe`)

---

## Normalization: Profit Per Area Per Day

### The Core Metric

The ultimate comparison metric is **Profit Per Area Per Day** (P/A). This normalizes all production chains to a common basis, accounting for:
- Space requirements (area)
- Production speed (runs per day)
- Entire supply chain (children's area needs)

### Calculation: buildScenarioRows

```typescript
function buildScenarioRows(option, indentLevel, amountNeeded, showChildren):
  // 1. Calculate demand
  demandUnitsPerDay = amountNeeded > 0 ? amountNeeded : (output1Amount × runsPerDay)
  runsPerDayRequired = demandUnitsPerDay / output1Amount

  // 2. Calculate self area
  areaPerOutput = selfAreaPerDay  // area needed per unit output per day
  scaledSelfAreaNeeded = areaPerOutput × demandUnitsPerDay

  // 3. Recursively calculate children's area needs
  for each MAKE input:
    childDemandPerDay = inputAmount × runsPerDayRequired
    childArea = buildScenarioRows(childOption, indentLevel+1, childDemandPerDay)
    childrenAreaNeededSum += childArea

  // 4. Calculate total area at capacity
  childrenAreaAtCapacity = (childrenAreaNeededSum / runsPerDayRequired) × runsPerDay
  totalAreaForOwnDenominator = fullSelfAreaPerDay + childrenAreaAtCapacity

  // 5. Compute P/A
  profitPerArea = stageProfitPerDay / totalAreaForOwnDenominator
```

### Key Insight: Area Scaling

- **At root level**: Uses `fullSelfAreaPerDay` (the building's full area)
- **For children**: Scales area proportionally to demand
  - If parent needs 50 units/day but child produces 100 units/day at capacity
  - Child only needs half its area to satisfy parent's demand
  - This prevents double-counting area requirements

### The "At Capacity" Concept

When calculating P/A for a recipe's own capacity:
```
childrenAreaAtCapacity = scale children's area needs to match parent's full production rate
```

This gives an apples-to-apples comparison: "If I run this recipe at full capacity, what's my profit per area?"

---

## Opportunity Cost

### The Concept

When you MAKE an input instead of BUYing it, you could have:
1. Made that input and sold it for profit
2. Instead, you're using it internally

The **opportunity cost** is the profit you're giving up by not selling it.

### Calculation

```typescript
// When choosing MAKE for an input:
totalOpportunityCost += childOption.baseProfitPerOutput × inputAmount

// Final adjusted profit:
finalProfit = baseProfit - totalOpportunityCost
adjProfitPerOutput = finalProfit / output1Amount
```

### Why It Matters

Without opportunity cost:
- A chain that makes everything might look profitable
- But you're ignoring that you could sell intermediate products for profit
- Opportunity cost reveals the true value-add of each production stage

With opportunity cost:
- Only MAKE an input if your value-add exceeds the market profit
- Otherwise, BUY the input and let others produce it profitably

### Base vs Adjusted Profit

- **baseProfit**: Profit ignoring opportunity costs (just revenue - costs)
- **profit** (adjProfit): Profit accounting for opportunity costs
- **baseProfitPerOutput**: Used as the opportunity cost for parent tickers
- **adjProfitPerOutput**: The true profitability metric for comparison

---

## Scenario Selection and Pruning

### The Exponential Problem

With 3 inputs, each with 2 options: 8 scenarios
With 5 inputs, each with 5 child recipes: 3,125 scenarios
With 3 levels deep: potentially millions of combinations

### Pruning Strategy: Depth-Based

```typescript
if (depth === 0) {
  // Root ticker: explore all direct input scenarios
  // Children: keep top 7 by P/A + one per display scenario
  childOptions = pruneForDiversity(childOptions, 7)
}
else if (depth === 1) {
  // Grandchildren: more aggressive pruning
  childOptions = pruneForDiversity(childOptions, 3)
}
else if (depth >= 2) {
  // Great-grandchildren: single best only
  childOptions = [bestOptionForTicker(...)]
}
```

### Pruning Strategy: Cost-Based

Inputs that contribute less to total cost are pruned more aggressively:

```typescript
function pruneByInputCostShare(inputs, depth):
  totalCost = Σ(input cost estimates)

  for each input:
    costShare = input.cost / totalCost

    if costShare < 5%:
      keep only 1 scenario  // Tiny contributor
    else if costShare < 15%:
      keep 2-3 scenarios    // Minor contributor
    else if costShare < 30%:
      keep 4-5 scenarios    // Moderate contributor
    else:
      keep all scenarios    // Major contributor (>30%)
```

**Rationale**: If an input represents 2% of total cost, exploring 10 scenarios for it has minimal impact on final results but explodes the search space.

### Diversity Preservation

`pruneForDiversity(options, topN)`:
1. Rank all options by P/A
2. Keep top N by P/A
3. Additionally keep one representative of each unique "display scenario"
4. This ensures variety while prioritizing high-performance options

### Best Scenario Selection

When `bestMap` provides a scenario for a ticker:
1. **Priority 1**: Exact scenario match (after normalization)
2. **Priority 2**: Highest P/A (fallback if no match or no bestMap entry)

This allows the UI to specify a "locked in" scenario for downstream tickers.

---

## Examples

### Example 1: Simple Recipe

**Ticker**: `RAT` (Rations)
**Recipe**:
- Inputs: 6 GRN, 2 BEA
- Outputs: 10 RAT
- Workforce: 15, Depreciation: 5
- Runs/Day: 12, Area: 25

**Prices** (PP7 on ANT):
- RAT: 100 (selling price)
- GRN: 80 (ask price)
- BEA: 120 (ask price)

**Scenario 1: Buy All Inputs**
```
totalOutputValue = 10 × 100 = 1,000
totalInputCost = (6 × 80) + (2 × 120) = 480 + 240 = 720
totalProductionCost = 720 + 15 + 5 = 740
baseProfit = 1,000 - 740 = 260

cogmPerOutput = 740 / 10 = 74
baseProfitPerOutput = 260 / 10 = 26

profitPerDay = 260 × 12 = 3,120
areaPerOutput = 25 / (12 × 10) = 0.208
profitPerArea = 3,120 / 25 = 124.8
```

**Scenario 2: Make GRN**

Assume making GRN has:
- cogmPerOutput = 70
- baseProfitPerOutput = 10 (you'd make 10 profit/unit if selling GRN)

```
inputCostGRN = 6 × 70 = 420  (cost to make)
inputCostBEA = 2 × 120 = 240  (cost to buy)
totalInputCost = 420 + 240 = 660
totalProductionCost = 660 + 15 + 5 = 680
baseProfit = 1,000 - 680 = 320

opportunityCost = 6 × 10 = 60  (GRN profit given up)
finalProfit = 320 - 60 = 260
adjProfitPerOutput = 260 / 10 = 26
```

In this case, both scenarios yield the same adjusted profit! This is expected: if making GRN costs exactly the market ask price, there's no advantage either way.

### Example 2: Multi-Level Chain

**Ticker**: `HI` (High-Tech Item)
**Recipe**:
- Inputs: 2 AI (Advanced Item), 3 BSE (Basic Supply)
- Outputs: 1 HI
- Runs/Day: 2, Area: 100

**AI Recipe**:
- Inputs: 5 BSE
- Outputs: 1 AI
- Runs/Day: 4, Area: 50

**Prices**:
- HI: 5,000
- AI: 1,000, cogm: 600, baseProfit: 400
- BSE: 100

**Scenario: Buy BSE, Make AI**

```
// AI production (child)
AI.cogmPerOutput = 600
AI.baseProfitPerOutput = 400
AI.area = 50, AI.runsPerDay = 4, AI.output = 1

// HI production (root)
inputCostAI = 2 × 600 = 1,200  (make)
inputCostBSE = 3 × 100 = 300   (buy)
totalInputCost = 1,500
baseProfit = 5,000 - 1,500 - productionCosts = (assume) 3,300

opportunityCost = 2 × 400 = 800  (AI profit given up)
finalProfit = 3,300 - 800 = 2,500

// Area calculation
HI.selfArea = 100
HI.runsPerDay = 2, HI.output = 1
HI.demandPerDay = 2 × 1 = 2 HI/day

AI.demandPerDay = 2 HI/day × 2 AI/HI = 4 AI/day
AI.runsRequired = 4 AI/day ÷ 1 AI/run = 4 runs/day
AI.areaNeeded = (4 runs / 4 capacity) × 50 = 50

totalArea = 100 (HI) + 50 (AI) = 150
profitPerArea = 2,500 / 150 = 16.67
```

---

## Additional Features

### Input Buffer Calculation

The system calculates a 7-day working capital buffer:
```
inputBuffer7 = 7 × ((totalInputCost + workforceCost) × runsPerDay)
```

This represents the currency needed to keep production running for 7 days, useful for financial planning.

### Build Cost Tracking

Similar to area, build costs are tracked through the entire chain:
```
totalBuildCost = selfBuildCost + Σ(child.buildCost × scaling)
```

This helps players understand the initial capital investment needed for a production chain.

### Force Constraints

The system supports forcing specific decisions:
- **forceMake**: Set of tickers that must be MADE (never BUY)
- **forceBuy**: Set of tickers that must be BOUGHT (never MAKE)
- **forceRecipe**: Set of recipe IDs that must be used (whitelist)
- **excludeRecipe**: Set of recipe IDs to exclude (blacklist)

These constraints propagate through the cache key to maintain correctness.

---

## Summary of Key Formulas

### Core Metrics
```
cogmPerOutput = (totalProductionCost - byproductValue) / output1Amount
baseProfit = totalOutputValue - totalProductionCost
finalProfit = baseProfit - totalOpportunityCost
profitPerDay = finalProfit × runsPerDay
```

### Area Normalization
```
selfAreaPerDay = area / (runsPerDay × output1Amount)
scaledSelfAreaNeeded = selfAreaPerDay × demandUnitsPerDay
childrenAreaAtCapacity = (childrenAreaSum / runsRequired) × runsPerDay
totalArea = selfArea + childrenAreaAtCapacity
profitPerArea = profitPerDay / totalArea
```

### Opportunity Cost
```
opportunityCost = Σ(childOption.baseProfitPerOutput × inputAmount) for MAKE inputs
finalProfit = baseProfit - opportunityCost
```

---

This analysis framework provides a comprehensive, mathematically sound approach to evaluating complex production chains, accounting for market prices, production constraints, space efficiency, and opportunity costs. The pruning strategies make it computationally feasible while preserving meaningful variety in the scenarios explored.

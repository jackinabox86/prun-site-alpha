# Dynamic Costs Calculation

This document explains how the `calculate-dynamic-costs.ts` script generates exchange-specific cost columns in the recipes CSV file.

## Overview

The `calculate-dynamic-costs.ts` script calculates three key cost components for each recipe across all exchanges:
- **Workforce Cost (WfCst)**: Labor costs based on workforce requirements and market prices
- **Depreciation Cost (Deprec)**: Equipment depreciation based on building costs
- **All-Build Cost (AllBuildCst)**: Total cost when all inputs are purchased rather than manufactured

These costs are calculated dynamically based on current market prices and stored in exchange-specific columns in `recipes-dynamic.csv`.

## Exchange-Specific Columns

For most exchanges (ANT, CIS, ICA, NCC), the script generates 3 columns per exchange:
```
WfCst-{EXCHANGE}
Deprec-{EXCHANGE}
AllBuildCst-{EXCHANGE}
```

For example, for ANT:
- `WfCst-ANT`
- `Deprec-ANT`
- `AllBuildCst-ANT`

### UNV Special Case

UNV is unique because it doesn't have Ask/Bid prices like other exchanges. Instead, UNV uses volume-weighted average prices over two time periods:
- **PP7**: 7-day price average
- **PP30**: 30-day price average

Because of this, UNV requires **6 columns** (3 for each price type):

**PP7 columns** (using 7-day averages):
- `WfCst-UNV7`
- `Deprec-UNV7`
- `AllBuildCst-UNV7`

**PP30 columns** (using 30-day averages):
- `WfCst-UNV30`
- `Deprec-UNV30`
- `AllBuildCst-UNV30`

## CSV Structure

The `recipes-dynamic.csv` file contains columns for all exchanges:

```csv
Ticker,RecipeID,...,WfCst-ANT,Deprec-ANT,AllBuildCst-ANT,WfCst-CIS,Deprec-CIS,AllBuildCst-CIS,...,WfCst-UNV7,Deprec-UNV7,AllBuildCst-UNV7,WfCst-UNV30,Deprec-UNV30,AllBuildCst-UNV30
DW,12345,...,100.5,50.2,200.0,105.3,52.1,210.5,...,98.7,49.3,195.4,102.1,51.0,203.2
```

## How the Analysis Engine Uses These Columns

When running best recipe analysis or production scenario analysis, the engine:

1. Receives an `exchange` parameter (e.g., "UNV") and a `priceType` parameter (e.g., "pp7" or "pp30")
2. Uses `getCostColumnNames()` to determine which columns to read:
   ```typescript
   function getCostColumnNames(exchange: Exchange, priceType: PriceType) {
     const suffix = exchange === "UNV"
       ? (priceType === "pp7" ? "7" : "30")
       : "";

     return {
       wfCst: `WfCst-${exchange}${suffix}`,
       deprec: `Deprec-${exchange}${suffix}`,
       allBuildCst: `AllBuildCst-${exchange}${suffix}`
     };
   }
   ```

3. For UNV with priceType "pp7":
   - Reads `WfCst-UNV7`, `Deprec-UNV7`, `AllBuildCst-UNV7`

4. For UNV with priceType "pp30":
   - Reads `WfCst-UNV30`, `Deprec-UNV30`, `AllBuildCst-UNV30`

5. For other exchanges (ANT, CIS, ICA, NCC):
   - Reads `WfCst-{EXCHANGE}`, `Deprec-{EXCHANGE}`, `AllBuildCst-{EXCHANGE}`
   - The priceType parameter is ignored (suffix is empty)

## Price Type Selection

When selecting which price type to use for UNV analysis:

- **PP7** (7-day average): More responsive to recent market changes, better for short-term planning
- **PP30** (30-day average): More stable, better for long-term planning and avoiding market volatility

The frontend typically allows users to switch between these price types when viewing UNV analysis.

## Running the Script

To regenerate the dynamic costs:

```bash
npm run calculate-costs
```

This will:
1. Load current prices from GCS
2. Calculate workforce costs, depreciation, and build costs for all recipes
3. Generate columns for all exchange variants (ANT, CIS, ICA, NCC, UNV7, UNV30)
4. Write the updated `recipes-dynamic.csv` file to `public/data/`

## Implementation Details

### ExchangeVariant Type

The script uses an `ExchangeVariant` type to handle both regular exchanges and UNV variants:

```typescript
type ExchangeVariant = Exchange | "UNV7" | "UNV30";
const EXCHANGE_VARIANTS: ExchangeVariant[] = ["ANT", "CIS", "ICA", "NCC", "UNV7", "UNV30"];
```

### Price Resolution

The `findPrice()` function handles UNV specially:

```typescript
function findPrice(
  ticker: string,
  pricesMap: Map<string, PriceRow>,
  exchange: Exchange,
  priceType: PriceType = "ask"
): number | null {
  const priceRow = pricesMap.get(ticker);
  if (!priceRow) return null;

  const prefix = EXCHANGE_PREFIXES[exchange];
  let priceKey: string;

  if (exchange === "UNV") {
    // For UNV, use PP7 or PP30 instead of AskPrice
    priceKey = priceType === "pp7" ? `${prefix}-PP7` : `${prefix}-PP30`;
  } else {
    // For other exchanges, use AskPrice
    priceKey = `${prefix}-AskPrice`;
  }

  const price = Number(priceRow[priceKey as keyof PriceRow]);
  return (price && price > 0) ? price : null;
}
```

This ensures that:
- UNV7 calculations use `UNV-PP7` price column
- UNV30 calculations use `UNV-PP30` price column
- Other exchanges use their respective `{EXCHANGE}-AskPrice` columns

# Resupply Feature Implementation Plan

## Context

Users need to determine if placing bids (buy orders) for needed supply materials at commodity exchanges is financially worthwhile compared to buying at ask price. This feature parses a user's planetary burn data, checks their existing warehouse supply and open orders, then compares ask vs. bid prices across all 4 exchanges to surface profitable bidding opportunities ranked by net savings.

## Why This Plan Is Phased

The original plan specified the entire client component as a single stage. That's ~800+ lines of interleaved computation logic and UI with 6 tightly coupled computation steps, 8 input controls, a multi-exchange comparison table, a stale bids section, and summary stats. By contrast, the existing `BidUpdateClient.tsx` is 615 lines with computation done server-side.

Breaking into phases means each step is:
- Small enough to implement correctly in one pass (~150-250 new lines)
- Independently testable before moving on
- Building on verified working code from the previous phase

## Files to Create

1. **`/app/api/resupply/route.ts`** — API route that proxies 4 FIO API calls
2. **`/app/resupply/page.tsx`** — Server page wrapper (boilerplate)
3. **`/app/resupply/ResupplyClient.tsx`** — Main client component (built incrementally across phases)

No modifications to existing files (nav not updated per user preference; page accessed via direct URL).

## Architecture: Hybrid Client/Server

- **API route** (`/api/resupply`): Fetches raw data from 4 FIO endpoints in parallel, returns it all to the client. GET request with `x-fio-username` and `x-fio-api-key` headers.
- **Client component**: Parses burn table, computes deficits, matches warehouse supply, compares prices, filters/sorts results. All computation in `useMemo` so parameter changes (target days, rate, exchange, ignore list, min savings) re-render instantly without re-fetching.

This avoids sending the burn table to the server and allows instant parameter tweaking.

## Shared Reference: Input Controls

All controls across all phases use `terminal-box` containers with `terminal-input`, `terminal-select`, `terminal-button` classes. All persisted settings use `usePersistedSettings` hook from `/src/hooks/usePersistedSettings.ts` with `{ updateUrl: false }`.

| Control | Type | Default | Persisted Key | Added In |
|---------|------|---------|---------------|----------|
| FIO Username | text input | "" | `prun:fio:username` (shared) | Phase 1 |
| FIO API Key | password input | "" | `prun:fio:apiKey` (shared) | Phase 1 |
| Commodity Exchange | dropdown (select) | "AI1" | `prun:resupply:exchange` | Phase 1 |
| Burn Table | textarea (~4 rows visible) | "" | Not persisted | Phase 2 |
| Target Days of Supply | number input | 14 | `prun:resupply:targetDays` | Phase 2 |
| Weekly Return Floor % | number input | 3 | `prun:resupply:weeklyRate` | Phase 3 |
| Ignore Tickers | text input | "" | `prun:resupply:ignoreTickers` | Phase 3 |
| Min Savings (at table top) | number input | 0 | `prun:resupply:minSavings` | Phase 3 |

Exchange dropdown options:
- Antares Station → code `AI1`
- Moria Station → code `NC1`
- Benten Station → code `CI1`
- Hortus Station → code `IC1`

---

## Phase 1: API Route + Page Scaffold + Data Fetch

**Goal**: Get the API route working and display raw data on the page. Verify the server-side plumbing end to end before writing any computation logic.

**Delivers**: A page at `/resupply` with credential inputs, an exchange dropdown, a fetch button, and a raw JSON debug view of the API response.

### 1a. API Route (`/app/api/resupply/route.ts`)

**Pattern**: Follow `/app/api/bid-update/route.ts` exactly.

**4 parallel FIO API calls** via `Promise.all`:

| # | Endpoint | Auth | Purpose |
|---|----------|------|---------|
| 1 | `GET /sites/warehouses/{username}` | Authorization: apiKey | Get warehouse StoreIds by LocationName |
| 2 | `GET /storage/{username}` | Authorization: apiKey | Get storage items per StorageId |
| 3 | `GET /exchange/all` | None | Get Ask/Bid prices for all tickers at all exchanges |
| 4 | `GET /cxos/{username}` | Authorization: apiKey | Get user's open orders |

**Response shape**:
```typescript
{
  warehouses: WarehouseEntry[],
  storage: StorageEntry[],
  exchangeData: ExchangeTicker[],
  orders: CxosOrder[],
}
```

**Interfaces**: Reuse `CxosOrder` and `ExchangeTicker` structures from `/app/api/bid-update/route.ts`. Add `WarehouseEntry` and `StorageEntry` based on FIO API shapes. Include `_sample` debug fields like bid-update does.

**Error handling**: Check each response `.ok`, return 502 on FIO failure, 500 on unexpected error.

### 1b. Server Page Wrapper (`/app/resupply/page.tsx`)

Standard boilerplate:
```typescript
import ResupplyClient from "./ResupplyClient";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function ResupplyPage() { return <ResupplyClient />; }
```

### 1c. Client Skeleton (`ResupplyClient.tsx` — initial version)

**Controls added this phase**: FIO Username, FIO API Key, Commodity Exchange dropdown, Fetch button.

**Data fetch** (`fetchData` callback):
- `GET /api/resupply` with credential headers
- Store raw response in `rawData` state
- Same pattern as `BidUpdateClient.tsx` lines 76-99

**Display**: Show loading state, error state, and a `<pre>` block with `JSON.stringify(rawData, null, 2)` so you can visually confirm all 4 API responses contain real data.

### Phase 1 Verification

1. Run `npm run dev`, navigate to `/resupply`
2. Enter credentials, click fetch
3. Confirm raw JSON shows populated `warehouses`, `storage`, `exchangeData`, `orders` arrays
4. Confirm 502 error displays correctly when using bad credentials

---

## Phase 2: Burn Table Parsing + Deficit Table

**Goal**: Parse the user's burn table, match warehouse inventory at the selected exchange, and show a simple deficit table. This is the core data pipeline — get it right before adding pricing.

**Delivers**: A table showing Ticker | Demand | On-Hand | Deficit for each consumed material.

### 2a. New Controls

Add to the input section: Burn Table textarea, Target Days of Supply input.

Burn table textarea should show a small preview area (~4 rows) with a parsed count below: e.g. "Parsed 45 consumption items from Overall".

### 2b. Computation (`useMemo` — first block)

Depends on: `rawData`, `burnText`, `selectedExchange`, `targetDays`

**Step 1 — Parse burn table**:
- Split by newlines, split each by `\t`
- Header row: `Planet, Ticker, Inv, Burn/day, Days`
- Filter: `Planet === "Overall"` AND `Burn/day < 0` (consumption only)
- Demand per ticker = `Math.abs(burnPerDay) * targetDays`

**Step 2 — Get on-hand supply at selected exchange**:
- Map exchange code to LocationName: `AI1→"Antares Station"`, `NC1→"Moria Station"`, `CI1→"Benten Station"`, `IC1→"Hortus Station"`
- Find warehouse entry matching LocationName → get `StoreId`
- Find storage entry where `StorageId === StoreId`
- Build `onHandMap: Map<ticker, amount>` from `StorageItems`
- If no warehouse found, warn user and treat on-hand as 0

**Step 3 — Compute raw deficits**:
- For each burn ticker: `deficit = demand - (onHandMap.get(ticker) || 0)`
- Keep all rows (including deficit <= 0) so the user can verify the math
- Mark rows with deficit <= 0 as "stocked" visually (dimmed)

### 2c. Deficit Table

Simple table replacing the raw JSON debug view:

| Column | Content |
|--------|---------|
| Ticker | Material ticker code |
| Demand | `abs(burnPerDay) * targetDays` |
| On-Hand | Warehouse quantity at selected exchange |
| Deficit | `demand - onHand` (or "Stocked" if <= 0) |

### Phase 2 Verification

1. Paste burn data into textarea, confirm "Parsed N consumption items" count
2. Verify demand = `abs(burn/day) * targetDays` for a few tickers manually
3. Switch exchange dropdown — on-hand values should update (different warehouse)
4. Change target days — demand and deficit columns should recalculate instantly (no re-fetch)
5. Tickers with sufficient on-hand should show as "Stocked"

---

## Phase 3: Price Comparison + Savings Table

**Goal**: Add exchange price lookups, the `incrementBid` function, and the full savings comparison across all 4 exchanges. This is the main value of the feature.

**Delivers**: The full results table with bid prices, savings, and return % across exchanges.

### 3a. New Controls

Add: Weekly Return Floor %, Ignore Tickers text input, Min Savings filter (above the table).

### 3b. Computation (extend `useMemo`)

Depends on (new): `weeklyRate`, `ignoreTickers`

**Step 4 — Build exchange price lookups**:
- `askMap: Map<"TICKER.EXCHANGE", askPrice>`
- `bidMap: Map<"TICKER.EXCHANGE", bidPrice>`
- From `rawData.exchangeData`, same pattern as bid-update route lines 104-113

**Step 5 — Compute resupply rows**:
- Required return threshold = `(1 + weeklyRate/100)^(targetDays/7) - 1`
- Filter out ignored tickers and tickers with deficit <= 0
- For each ticker with remaining deficit > 0:
  - Get `askAtSelected = askMap.get("TICKER.selectedExchange")`
  - For each of the 4 exchanges, compute the effective bid price:
    - `incrementBid(marketBid)` (increment 3rd significant figure)
  - Per-unit savings = `askAtSelected - effectiveBidPrice`
  - Return % = `(askAtSelected - effectiveBidPrice) / effectiveBidPrice`
  - Net savings = `perUnitSavings * deficit`
  - Track savings at selected exchange AND best savings across all 4
  - Filter: include row if return % at selected exchange OR best exchange >= threshold
- Sort by net savings descending (at selected exchange)

**`incrementBid` function** — Increment at 3rd significant figure:
```
magnitude = Math.floor(Math.log10(n))
increment = 10^(magnitude - 2)
result = n + increment
Round to avoid floating point artifacts
```
Examples: 10.1→10.2, 1020→1030, 99→100, 0.5→0.501

### 3c. Results Table

Replace the simple deficit table with the full results table. Filtered by min savings at the top.

| Column | Content |
|--------|---------|
| Ticker | Material ticker code |
| Deficit | Quantity needed |
| Ask (selected) | Ask price at selected exchange |
| Bid (AI1) | Market bid at Antares |
| Bid (NC1) | Market bid at Moria |
| Bid (CI1) | Market bid at Benten |
| Bid (IC1) | Market bid at Hortus |
| Savings @ Selected | Net savings amount (return % parenthetical) |
| Best Savings | Net savings amount (return % parenthetical) + exchange label |

Ranked by net savings descending. Sortable column headers.

### Phase 3 Verification

1. Verify ask prices match the selected exchange
2. Verify bid columns show market bid for each exchange
3. Pick a ticker, manually compute: `savings = (ask - incrementBid(bid)) * deficit` — should match
4. Change weekly return floor — rows below threshold should disappear
5. Add a ticker to ignore list — it should vanish from results
6. Change min savings — low-savings rows should filter out
7. Switch exchange — ask prices and savings should recalculate

---

## Phase 4: Order Integration + Stale Bids + Summary

**Goal**: Account for the user's existing open orders. Deduct active top bids from deficits, flag stale bids for cleanup, and add summary stats.

**Delivers**: Final polished feature with order-aware deficits, stale bid warnings, and summary boxes.

### 4a. Computation (extend `useMemo` — insert between Steps 4 and 5)

**New Step — Process user orders (stale bids + top bid deductions)**:
- Filter orders: `OrderType === "BUYING"` AND `Status in ("PLACED", "PARTIALLY_FILLED")`
- For each active buy order, look up market bid for that `ticker.exchange`:
  - If `order.Limit === marketBid` → user has top bid → track for deficit deduction
  - If `order.Limit !== marketBid` → stale bid → add to stale bids list
- Deduct top-bid amounts from deficits (only at the ticker level, regardless of exchange, since the user's existing order covers that quantity)

**Update to resupply row computation** (existing Step 5):
- When computing effective bid price per exchange:
  - If user has top bid at that exchange → use their limit price (already the top bid)
  - Else → `incrementBid(marketBid)` as before

### 4b. Stale Bids Section

Separate `terminal-box` with warning styling, shown only when stale bids exist.
Table columns: Ticker, Exchange, My Limit, Market Bid, Amount.
Purpose: Alert user to remove/update these orders in-game.

### 4c. Summary Stats

Row of stat boxes (same visual pattern as bid-update):
- Total deficit tickers analyzed
- Total potential savings
- Stale bid count

### Phase 4 Verification

1. If user has open buy orders, verify stale ones (limit ≠ market bid) appear in stale bids section
2. Verify top-bid orders reduce the deficit amount for that ticker
3. Verify that tickers where the user already covers the full deficit via existing orders are excluded
4. Verify summary stats match the table data
5. Full golden path: credentials → paste burn data → review deficits → review savings → check stale bids

---

## Key Reusable Code

| What | Location |
|------|----------|
| `usePersistedSettings` hook | `/src/hooks/usePersistedSettings.ts` |
| FIO credential storage keys | `prun:fio:username`, `prun:fio:apiKey` |
| FIO API proxy pattern | `/app/api/bid-update/route.ts` |
| `CxosOrder` / `ExchangeTicker` interfaces | `/app/api/bid-update/route.ts` lines 5-39 |
| Exchange labels (AI1→ANT etc.) | `/app/bid-update/BidUpdateClient.tsx` lines 37-42 |
| Client fetch + error/loading pattern | `/app/bid-update/BidUpdateClient.tsx` lines 76-99 |
| Terminal CSS classes | `/app/globals.css` |

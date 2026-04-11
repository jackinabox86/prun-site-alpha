# Resupply Feature Implementation Plan

## Context

Users need to determine if placing bids (buy orders) for needed supply materials at commodity exchanges is financially worthwhile compared to buying at ask price. This feature parses a user's planetary burn data, checks their existing warehouse supply and open orders, then compares ask vs. bid prices across all 4 exchanges to surface profitable bidding opportunities ranked by net savings.

## Files to Create

1. **`/app/resupply/page.tsx`** — Server page wrapper (boilerplate, same pattern as `/app/bid-update/page.tsx`)
2. **`/app/resupply/ResupplyClient.tsx`** — Main client component with all UI and computation logic
3. **`/app/api/resupply/route.ts`** — API route that proxies 4 FIO API calls

No modifications to existing files (nav not updated per user preference; page accessed via direct URL).

## Architecture: Hybrid Client/Server

- **API route** (`/api/resupply`): Fetches raw data from 4 FIO endpoints in parallel, returns it all to the client. GET request with `x-fio-username` and `x-fio-api-key` headers.
- **Client component**: Parses burn table, computes deficits, matches warehouse supply, compares prices, filters/sorts results. All computation in `useMemo` so parameter changes (target days, rate, exchange, ignore list, min savings) re-render instantly without re-fetching.

This avoids sending the burn table to the server and allows instant parameter tweaking.

---

## 1. API Route (`/app/api/resupply/route.ts`)

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

---

## 2. Server Page Wrapper (`/app/resupply/page.tsx`)

Standard boilerplate:
```typescript
import ResupplyClient from "./ResupplyClient";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function ResupplyPage() { return <ResupplyClient />; }
```

---

## 3. Client Component (`/app/resupply/ResupplyClient.tsx`)

### 3a. Input Controls Section

All in `terminal-box` containers using `terminal-input`, `terminal-select`, `terminal-button` classes.

| Control | Type | Default | Persisted Key |
|---------|------|---------|---------------|
| FIO Username | text input | "" | `prun:fio:username` (shared) |
| FIO API Key | password input | "" | `prun:fio:apiKey` (shared) |
| Commodity Exchange | dropdown (select) | "AI1" | `prun:resupply:exchange` |
| Target Days of Supply | number input | 14 | `prun:resupply:targetDays` |
| Weekly Return Floor % | number input | 3 | `prun:resupply:weeklyRate` |
| Ignore Tickers | text input | "" | `prun:resupply:ignoreTickers` |
| Burn Table | textarea (short height, ~4 rows visible) | "" | Not persisted |
| Min Savings (at table top) | number input | 0 | `prun:resupply:minSavings` |

Exchange dropdown options:
- Antares Station → code `AI1`
- Moria Station → code `NC1`
- Benten Station → code `CI1`
- Hortus Station → code `IC1`

All persisted settings use `usePersistedSettings` hook from `/src/hooks/usePersistedSettings.ts` with `{ updateUrl: false }`.

Burn table textarea should show a small preview area (~4 rows) with a parsed count below: e.g. "Parsed 45 consumption items from Overall".

### 3b. Data Fetch (`fetchData` callback)

- `GET /api/resupply` with credential headers
- Store raw response in `rawData` state
- Same pattern as `BidUpdateClient.tsx` lines 76-99

### 3c. Core Computation (`useMemo`)

Depends on: `rawData`, `burnText`, `selectedExchange`, `targetDays`, `weeklyRate`, `ignoreTickers`

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
- Exclude ignored tickers and tickers with deficit <= 0

**Step 4 — Build exchange price lookups**:
- `askMap: Map<"TICKER.EXCHANGE", askPrice>`
- `bidMap: Map<"TICKER.EXCHANGE", bidPrice>`
- From `rawData.exchangeData`, same pattern as bid-update route lines 104-113

**Step 5 — Process user orders (stale bids + top bid deductions)**:
- Filter orders: `OrderType === "BUYING"` AND `Status in ("PLACED", "PARTIALLY_FILLED")`
- For each active buy order, look up market bid for that `ticker.exchange`:
  - If `order.Limit === marketBid` → user has top bid → track for deficit deduction
  - If `order.Limit !== marketBid` → stale bid → add to stale bids list
- Deduct top-bid amounts from deficits (only at the ticker level, regardless of exchange, since the user's existing order covers that quantity)

**Step 6 — Compute resupply rows**:
- Required return threshold = `(1 + weeklyRate/100)^(targetDays/7) - 1`
- For each ticker with remaining deficit > 0:
  - Get `askAtSelected = askMap.get("TICKER.selectedExchange")`
  - For each of the 4 exchanges, compute the effective bid price:
    - If user has top bid at that exchange → use their limit price
    - Else → `incrementBid(marketBid)` (increment 3rd significant figure)
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

### 3d. Results Table

Filtered by minimum total net savings filter (at table top).

**Columns**:
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

### 3e. Stale Bids Section

Separate `terminal-box` with warning styling, shown only when stale bids exist.
Table columns: Ticker, Exchange, My Limit, Market Bid, Amount.
Purpose: Alert user to remove/update these orders in-game.

### 3f. Summary Stats

Row of stat boxes (same visual pattern as bid-update):
- Total deficit tickers analyzed
- Total potential savings
- Stale bid count

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

---

## Verification Plan

1. **API route**: After creating, test with curl or browser devtools — verify all 4 FIO responses return data
2. **Burn table parsing**: Paste the example burn data; verify "Parsed N consumption items from Overall" count matches expected (items with negative Burn/day under Overall)
3. **Deficit calculation**: Manually verify a couple tickers: demand = abs(burn/day) * targetDays - onHand - existingTopBidAmount
4. **Stale bids**: If user has open orders, verify stale ones appear in the stale bids section
5. **Savings math**: Pick a ticker, verify: savings = (ask - incrementedBid) * deficit, return % = (ask - incrementedBid) / incrementedBid
6. **Filters**: Change min savings, weekly rate, target days — verify table updates instantly without re-fetch
7. **Exchange switching**: Switch dropdown — verify ask prices, on-hand supply, and savings recalculate
8. **Ignore tickers**: Add a ticker to ignore list — verify it disappears from results
9. **Dev server**: Run `npm run dev`, navigate to `/resupply`, test full golden path

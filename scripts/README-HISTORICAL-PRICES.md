# Historical Price Data Fetching

This directory contains scripts for fetching and managing historical price data from the FNAR API for Prosperous Universe materials.

## Overview

The historical price fetching system:
- Pulls OHLC (Open, High, Low, Close) candlestick data from FNAR API
- Stores data locally in JSON format (one file per ticker/exchange)
- Implements rate limiting and retry logic for API safety
- Supports batch processing for efficient fetching
- Configurable for different material baskets

## Files

```
scripts/
├── fetch-historical-prices.ts    # Main fetch script
├── test-fetch-structure.ts       # Test script (uses mock data)
├── config/
│   └── materials.ts              # Material configuration and baskets
└── lib/
    └── rate-limiter.ts           # API rate limiting class
```

## Usage

### Test Mode (Single Material)

Fetch just RAT on ANT exchange for testing:

```bash
npm run fetch-historical
```

### Essentials Mode

Fetch the essentials basket (10 high-priority materials) across all 4 exchanges:

```bash
MODE=essentials npm run fetch-historical
```

This fetches 40 endpoints (10 tickers × 4 exchanges).

### Full Mode

Fetch all materials across all exchanges:

```bash
MODE=full npm run fetch-historical
```

**⚠️ Warning:** This fetches ~200+ endpoints. Will take 10-15 minutes with rate limiting.

## Output

Data is saved to: `public/data/historical-prices/`

File format: `{TICKER}-{exchange}.json`

Example: `RAT-ai1.json`

### File Structure

```json
{
  "ticker": "RAT",
  "exchange": "ai1",
  "lastUpdated": 1762654840590,
  "data": [
    {
      "Interval": "DAY_ONE",
      "DateEpochMs": 1689984000000,
      "Open": 112,
      "Close": 113,
      "High": 114,
      "Low": 98,
      "Volume": 1283219.75,
      "Traded": 11529
    },
    // ... more days
  ]
}
```

## Exchange Mapping

Our codes → FNAR API codes:
- `ANT` → `ai1` (Antares)
- `CIS` → `ci1` (Castile)
- `ICA` → `ic1` (Hortus)
- `NCC` → `nc1` (Moria)

## Material Configuration

Edit `scripts/config/materials.ts` to:
- Add/remove materials
- Organize by category
- Set priority levels (high/medium/low)
- Define custom baskets

### Predefined Baskets

- `essentials` - 10 high-liquidity materials (recommended for inflation index)
- `consumables` - Food and consumable items
- `construction` - Construction materials
- `basicMaterials` - Raw materials
- `comprehensive` - All high + medium priority materials

## Rate Limiting & Monitoring

The rate limiter automatically:
- Retries failed requests (up to 3 times)
- Handles HTTP 429 (rate limit) responses
- Implements exponential backoff
- Tracks request metrics
- Provides detailed progress logging

### Metrics Displayed

- Total requests / Successful / Failed
- Rate limit hits
- Average response time
- Requests per second
- Total data points fetched

## Batch Processing

Configurable per mode:

```typescript
{
  batchSize: 10,     // How many concurrent requests
  delayMs: 1000,     // Delay between batches (milliseconds)
}
```

**Test mode** uses smaller batches (1) for safety.
**Essentials/Full** use 10 concurrent requests with 1s delays.

## Next Steps

After fetching historical data:

1. **Analyze the data** - Run analysis to determine best materials for baskets
2. **Calculate VWAPs** - Compute volume-weighted averages (PP7, PP30)
3. **Upload to GCS** - Store in Google Cloud Storage for production use
4. **Set up daily updates** - Incremental script to append new daily data
5. **Build charts** - Create inflation index visualizations

## Troubleshooting

### Network Errors

If you see `fetch failed` or `getaddrinfo` errors:
- Check internet connection
- Verify FNAR API is accessible: https://rest.fnar.net
- Try reducing batch size
- Increase delays between requests

### Rate Limiting

If you hit rate limits frequently:
- Reduce `batchSize` (try 5 instead of 10)
- Increase `delayMs` (try 2000ms instead of 1000ms)
- Run in smaller chunks (use essentials mode first)

### Timeouts

If requests timeout:
- Increase `requestTimeout` in ApiRateLimiter config
- Check FNAR API status
- Try again during off-peak hours

## Examples

### Fetch specific basket

Create a custom mode in `fetch-historical-prices.ts`:

```typescript
custom: {
  tickers: ["RAT", "DW", "FE"],
  exchanges: ["ANT"],
  outputDir: "public/data/historical-prices",
  batchSize: 3,
  delayMs: 500,
}
```

Then run:

```bash
MODE=custom npm run fetch-historical
```

### Test without network

Use the test script with mock data:

```bash
npx tsx scripts/test-fetch-structure.ts
```

## API Endpoints

FNAR API pattern:
```
https://rest.fnar.net/exchange/cxpc/{ticker}.{exchange}
```

Example:
```
https://rest.fnar.net/exchange/cxpc/rat.ai1
```

Returns array of OHLC data with multiple interval types. We filter for `"Interval": "DAY_ONE"`.

## Data Considerations

- **Historical depth**: FNAR typically provides ~30-90 days of history
- **Missing data**: Some materials don't trade on all exchanges
- **Stale data**: Thin markets may have gaps in trading days
- **Spike detection**: Implement sanitization before using in indices (see PRUNplanner approach)

## License

Same as parent project.

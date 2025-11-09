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

### Current Configuration

The script is currently configured to fetch **RAT on AI1 (ANT exchange)** only:

```bash
npm run fetch-historical
```

This is a simple starting point to test the system and get familiar with the data structure.

### Future Expansion

The script can be easily expanded to fetch:
- Multiple materials (uncomment `ESSENTIALS_CONFIG` or `FULL_CONFIG` in the script)
- Multiple exchanges (ANT, CIS, ICA, NCC)
- Custom material baskets (edit `CONFIG` in the script)

To expand, edit `scripts/fetch-historical-prices.ts` and modify the `CONFIG` object.

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

### Predefined Baskets (For Future Use)

The `scripts/config/materials.ts` file contains predefined baskets that can be used when expanding:

- `essentials` - 10 high-liquidity materials (recommended for inflation index)
- `consumables` - Food and consumable items
- `construction` - Construction materials
- `basicMaterials` - Raw materials
- `comprehensive` - All high + medium priority materials

To use these, uncomment the `ESSENTIALS_CONFIG` or `FULL_CONFIG` in `fetch-historical-prices.ts`.

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

Current configuration:

```typescript
{
  tickers: ["RAT"],
  exchanges: ["ANT"],
  batchSize: 1,      // Single request (only 1 endpoint)
  delayMs: 500,      // 500ms delay
}
```

When expanding to multiple materials, increase `batchSize` to 10 and `delayMs` to 1000ms for efficiency.

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

### Expand to multiple materials

Edit `fetch-historical-prices.ts` and modify the `CONFIG`:

```typescript
const CONFIG: FetchConfig = {
  tickers: ["RAT", "DW", "FE"],  // Add more materials
  exchanges: ["ANT"],
  outputDir: "public/data/historical-prices",
  batchSize: 3,
  delayMs: 500,
};
```

### Expand to all exchanges

```typescript
const CONFIG: FetchConfig = {
  tickers: ["RAT"],
  exchanges: ["ANT", "CIS", "ICA", "NCC"],  // All 4 exchanges
  outputDir: "public/data/historical-prices",
  batchSize: 4,
  delayMs: 500,
};
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

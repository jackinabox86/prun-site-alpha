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

## Branch-Aware Behavior

The fetch and upload scripts automatically detect the current git branch:

- **main branch**: 🟢 PRODUCTION mode
  - Local: `public/data/historical-prices/`
  - GCS: `gs://prun-site-alpha-bucket/historical-prices/`

- **other branches**: 🟡 TEST mode
  - Local: `public/data/historical-prices-test/`
  - GCS: `gs://prun-site-alpha-bucket/historical-prices-test/{branch-name}/`

This ensures test data never overwrites production data.

## Usage

### Current Configuration

The script is currently configured to fetch **RAT on AI1 (ANT exchange)** only:

```bash
npm run fetch-historical
```

This is a simple starting point to test the system and get familiar with the data structure.

### Uploading to GCS

After fetching data, upload to Google Cloud Storage:

```bash
npm run upload-historical
```

**Production uploads (main branch only):**
- Includes a 5-second warning before uploading
- Overwrites production historical data
- Use with caution!

**Test uploads (all other branches):**
- Uploads immediately to test folder
- Safe to run without affecting production

### Expanding to All Tickers

To fetch all 333 tickers across all 4 exchanges (1,332 endpoints):

1. **Edit** `scripts/fetch-historical-prices.ts`
2. **Comment out** Option 1 (RAT only)
3. **Uncomment** Option 2 (all tickers from file)

```typescript
// Option 1: Single ticker for testing (default)
// const CONFIG: FetchConfig = {
//   tickers: ["RAT"],
//   ...
// };

// Option 2: All tickers from file × all exchanges (~1332 endpoints)
const CONFIG: FetchConfig = {
  tickers: loadTickersFromFile("scripts/config/tickers.txt"),
  exchanges: ["ANT", "CIS", "ICA", "NCC"], // All 4 exchanges
  ...
  batchSize: 10, // 10 concurrent requests
  delayMs: 1000, // 1 second between batches
};
```

**⚠️ Important:**
- Will take **20-25 minutes** to complete
- Makes **1,332 API requests** to FNAR
- Generates **1,332 JSON files** (~3-4 MB total)
- Best run once for initial data, then use daily updates

### Customizing the Ticker List

Edit `scripts/config/tickers.txt` to add/remove tickers:
- One ticker per line
- Lines starting with `#` are comments (ignored)
- Blank lines are ignored

Example:
```
RAT
DW
FE
# AL  <- This line is ignored (commented out)
O
```

## Typical Workflow

### For Development/Testing (non-main branches):

```bash
# 1. Create/checkout your feature branch
git checkout -b my-feature-branch

# 2. Fetch historical data
npm run fetch-historical

# 3. Verify the data looks good
cat public/data/historical-prices-test/RAT-ai1.json

# 4. Upload to GCS test folder
npm run upload-historical
# → Uploads to gs://prun-site-alpha-bucket/historical-prices-test/my-feature-branch/

# 5. Test is complete, safe to experiment!
```

### For Production (main branch only):

```bash
# 1. Ensure you're on main
git checkout main

# 2. Fetch historical data
npm run fetch-historical

# 3. Carefully verify the data
cat public/data/historical-prices/RAT-ai1.json

# 4. Upload to production GCS
npm run upload-historical
# → Shows 5-second warning
# → Uploads to gs://prun-site-alpha-bucket/historical-prices/
```

## Output

**Branch-dependent paths:**

- Production (main): `public/data/historical-prices/`
- Test (other): `public/data/historical-prices-test/`

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

# Historical Price Data Scripts

This directory contains scripts for fetching, analyzing, and managing historical price data from the FNAR API.

## Branch-Aware Workflow

All scripts automatically detect the current git branch and adjust their behavior:

### On `main` branch (Production)
- **Data location**: `public/data/historical-prices/`
- **GCS location**: `gs://prun-site-alpha-bucket/historical-prices/`
- **Skip existing**: ✅ Enabled - Only fetches NEW tickers, skips existing files
- **Purpose**: Production data updates, adding new tickers

### On other branches (Development/Testing)
- **Data location**: `public/data/historical-prices-test/`
- **GCS location**: `gs://prun-site-alpha-bucket/historical-prices-test/{branch-name}/`
- **Skip existing**: ❌ Disabled - Re-fetches all data
- **Purpose**: Testing, experimentation, validation

## Quick Start

### Initial Setup (Already Done)
The production GCS bucket already has all 1,332 historical price files (333 tickers × 4 exchanges).
Local data directories are not committed to git - all data lives in GCS.

### Adding New Tickers

When you need to add new tickers to the system:

1. **Add ticker to config**:
   ```bash
   echo "NEW_TICKER" >> scripts/config/tickers.txt
   ```

2. **On feature branch** (test first):
   ```bash
   npm run fetch-historical        # Fetches only the new ticker
   npm run analyze-historical      # Verify data looks good
   npm run check-empty-historical  # Check for empty files
   ```

3. **Merge to main** (production):
   ```bash
   git checkout main
   git merge your-feature-branch
   npm run fetch-historical        # Auto-skips existing 1332 files
                                   # Only fetches NEW tickers
   ```

4. **Upload to GCS**:
   ```bash
   npm run upload-historical       # Uploads to production
   ```

## Available Scripts

### Data Fetching

#### `npm run fetch-historical`
Fetches historical price data for all configured tickers.
- On main: Skips existing files, only fetches new tickers
- On branches: Re-fetches all data for testing
- **Note**: Local data is not kept - all data lives in GCS

#### `npm run update-daily-historical`
Daily incremental update that fetches only yesterday's data.
- Fetches using API endpoint: `/exchange/cxpc/{ticker}/{timestamp}`
- Downloads existing files from GCS
- Appends new data point for each ticker/exchange
- Uploads updated files back to GCS
- Tracks failures in missed days log
- Runs automatically via GitHub Actions at 04:00 UTC daily
- **Dry run**: `npm run update-daily-historical -- --dry-run`

#### `npm run retry-missed-days`
Retries failed fetches from previous runs.
- Loads missed days log from GCS
- Retries only failures from last 7 days
- Removes successful retries from log
- Updates failure records with new attempts
- Runs automatically after daily update
- **Dry run**: `npm run retry-missed-days -- --dry-run`

### Data Analysis

#### `npm run analyze-historical [prod|test]`
Comprehensive analysis of historical price data from GCS:
- Summary statistics (total records, tickers, exchanges)
- Top files by record count, volume, and trade count
- Files with least records (potential issues)
- Recent activity (last 30 days)
- Can analyze specific ticker: `npm run analyze-historical -- --ticker=RAT`
- **Note**: Downloads from GCS temporarily for analysis

### GCS Management

#### `npm run upload-missing-gcs`
Uploads specific missing files to GCS.
- Use after fetching new tickers
- Uploads to branch-appropriate GCS location

#### `npm run move-to-production-gcs`
Copies files from test folder to production folder in GCS.
- Direct GCS-to-GCS copy (no download needed)
- Useful for promoting test data to production

### Testing

#### `npm run test-production-mode`
Tests production mode detection and configuration.
- Verifies branch detection works correctly
- Shows what paths will be used on main branch
- Confirms skipExisting behavior

## Configuration

### Ticker Configuration
Edit `scripts/config/tickers.txt` to add/remove tickers:
```
# One ticker per line
# Lines starting with # are comments
RAT
DW
EPO
```

### Fetch Configuration
Edit `scripts/fetch-historical-prices.ts`:
- Currently set to fetch all tickers from config file
- Fetches from all 4 exchanges (ANT, CIS, ICA, NCC)
- Batch size: 10 concurrent requests
- Delay: 1 second between batches

## Data Structure

Each JSON file contains:
```json
{
  "ticker": "RAT",
  "exchange": "ai1",
  "lastUpdated": 1762793178972,
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
    }
  ]
}
```

## Automated Daily Updates

### GitHub Actions Workflow

The system automatically updates daily via GitHub Actions:

**Schedule**: 04:00 UTC every day (4 hours after new day begins)
**Workflow**: `.github/workflows/update-daily-historical.yml`
**Branch**: Only runs on `main`

### What Happens Daily

1. **Fetch Yesterday's Data**
   - Calculates previous day's timestamp (00:00 UTC)
   - Hits API: `GET /exchange/cxpc/{ticker}.{exchange}/{timestamp}`
   - Processes all 1,332 ticker/exchange combinations

2. **Update Files**
   - Downloads existing file from GCS
   - Appends new data point if not already present
   - Validates and sorts data by date
   - Uploads updated file back to GCS

3. **Track Failures**
   - Logs any failed fetches to `historical-prices-missed-days.json` in GCS
   - Tracks: ticker, exchange, date, timestamp, error, attempts

4. **Retry Missed Days**
   - Automatically retries failures from last 7 days
   - Removes successful retries from log
   - Keeps only recent failures

### Missed Days Log Structure

**Location**: `gs://prun-site-alpha-bucket/historical-prices-missed-days.json`

```json
{
  "lastUpdated": 1762793178972,
  "failures": [
    {
      "ticker": "RAT",
      "exchange": "ai1",
      "date": "2025-11-09",
      "timestamp": 1731110400000,
      "error": "HTTP 503: Service unavailable",
      "attempts": 2,
      "firstAttempt": 1731196800000,
      "lastAttempt": 1731283200000
    }
  ]
}
```

### Manual Triggers

You can manually trigger the workflow from GitHub Actions:
- Go to Actions → "Update Daily Historical Prices"
- Click "Run workflow"
- Optionally enable dry-run mode

### Monitoring

Check workflow status:
- **GitHub Actions**: View run history and logs
- **GCS Missed Days Log**: Check for persistent failures
- **Workflow Summary**: Each run generates a detailed summary

## Typical Workflows

### Workflow 1: Adding a New Ticker
```bash
# 1. Add to config
echo "NEW" >> scripts/config/tickers.txt

# 2. Test on feature branch
git checkout -b add-new-ticker
npm run fetch-historical          # Fetches NEW across all exchanges
npm run analyze-historical         # Verify data

# 3. Merge to main
git checkout main
git merge add-new-ticker
npm run fetch-historical          # Skips existing 1332, fetches only NEW (4 files)
npm run upload-historical          # Upload to production
```

### Workflow 2: Analyze Existing Data
```bash
# Analyze production data (from GCS)
npm run analyze-historical prod

# Analyze with specific ticker
npm run analyze-historical prod -- --ticker=RAT

# Test production mode configuration
npm run test-production-mode
```

## Important Notes

1. **Production Safety**: The skipExisting feature ensures you never accidentally re-download all 1,332 files when on main branch.

2. **Data Storage**: All historical price data lives in GCS. Local directories are temporary and not committed to git.

3. **Branch Detection**: Scripts use multiple fallback methods to detect the branch, including support for GitHub Codespaces.

4. **GCS Paths**: Test data goes to branch-specific folders (`historical-prices-test/{branch-name}`), preventing conflicts between branches.

5. **Empty Files**: ~107 files have empty data arrays because those tickers were never traded on those exchanges. This is expected.

## Troubleshooting

### "All files already exist" when I want to re-fetch
You're on main branch with skipExisting enabled. This is expected behavior to avoid re-downloading all 1,332 files.
- To fetch updates for existing tickers: Delete the local files first, or they'll be skipped
- To test: Switch to a feature branch where skipExisting is disabled

### Need to download data from GCS for analysis
Use gsutil to download specific files:
```bash
# Download all production data
gsutil -m cp -r gs://prun-site-alpha-bucket/historical-prices/* public/data/historical-prices/

# Download specific ticker
gsutil cp gs://prun-site-alpha-bucket/historical-prices/RAT-*.json public/data/historical-prices/
```

### GCS upload fails
Ensure you have `gsutil` configured and authenticated:
```bash
gcloud auth login
gsutil ls gs://prun-site-alpha-bucket/
```

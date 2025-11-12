#!/bin/bash
# Script to rebuild historical index files from actual GCS snapshot files
# This fixes indices that were corrupted by timestamp mismatches

set -e

BUCKET="prun-site-alpha-bucket"
GCS_BASE="gs://${BUCKET}/historical"

echo "🔧 Rebuilding historical indices from actual snapshot files..."
echo ""

rebuild_index() {
  local config=$1
  local exchange=$2
  local sellAt=$3

  echo "📋 Processing ${config}..."

  # List all actual snapshot files for this config
  local files=$(gsutil ls "${GCS_BASE}/${config}/*.json" | grep -v "index.json" || true)

  if [ -z "$files" ]; then
    echo "  ⚠️  No snapshot files found for ${config}"
    return
  fi

  # Start building new index
  local temp_file="/tmp/index-${config}-rebuild.json"
  echo '{"snapshots":[],"exchange":"","sellAt":"","lastUpdated":""}' > "$temp_file"

  # Process each file
  local count=0
  local latest_ts=""

  while IFS= read -r file_path; do
    # Extract timestamp from filename (e.g., "2025-11-09T16-33-07Z.json")
    local filename=$(basename "$file_path")
    local timestamp="${filename%.json}"

    # Download the file to read metadata
    local data_file="/tmp/snapshot-${config}-${count}.json"
    gsutil -q cp "$file_path" "$data_file" 2>/dev/null || {
      echo "    ⚠️  Failed to download $filename, skipping"
      continue
    }

    # Count tickers in the file
    local ticker_count=$(jq 'length' "$data_file" 2>/dev/null || echo "0")

    # Add entry to index
    temp_file=$(mktemp)
    jq --arg ts "$timestamp" \
       --argjson count "$ticker_count" \
       --arg exch "$exchange" \
       --arg sell "$sellAt" \
       '.snapshots += [{
         timestamp: $ts,
         generatedAt: $ts,
         tickerCount: $count,
         durationSeconds: 0
       }] |
       .exchange = $exch |
       .sellAt = $sell |
       .lastUpdated = $ts' \
       "/tmp/index-${config}-rebuild.json" > "$temp_file"

    mv "$temp_file" "/tmp/index-${config}-rebuild.json"

    latest_ts="$timestamp"
    count=$((count + 1))

    # Clean up temp data file
    rm -f "$data_file"
  done <<< "$files"

  echo "    ✅ Found $count snapshots"

  if [ $count -gt 0 ]; then
    # Upload rebuilt index
    gsutil -h "Cache-Control:public, max-age=300" \
           -h "Content-Type:application/json" \
           cp "/tmp/index-${config}-rebuild.json" \
           "${GCS_BASE}/${config}/index.json"

    echo "    ✅ Uploaded new index with $count entries"
  fi

  # Clean up
  rm -f "/tmp/index-${config}-rebuild.json"
}

# Rebuild indices for all standard configurations
for exchange in ANT CIS ICA NCC; do
  for sellAt in bid ask pp7; do
    rebuild_index "best-recipes-${exchange}-${sellAt}" "${exchange}" "${sellAt}"
  done
done

# Rebuild indices for UNV special cases
rebuild_index "best-recipes-UNV7" "UNV" "pp7"
rebuild_index "best-recipes-UNV30" "UNV" "pp30"

echo ""
echo "✅ All indices rebuilt successfully!"
echo ""
echo "You can verify by checking:"
echo "https://storage.googleapis.com/prun-site-alpha-bucket/historical/best-recipes-ANT-bid/index.json"

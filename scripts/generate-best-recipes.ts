#!/usr/bin/env tsx
/**
 * Generate best recipes data at build time
 * This runs during deployment to pre-compute best recipe analysis
 * Generates data for all exchanges with all sell price options
 * Standard exchanges (ANT, CIS, ICA, NCC): bid, ask, pp7
 * UNV special cases: UNV7 (pp7), UNV30 (pp30) - not displayed in UI
 * For each config, generates BOTH standard and extraction variants
 * Total: (12 standard + 2 UNV) × 2 modes = 28 files
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parse } from 'csv-parse/sync';
import { refreshBestRecipeIDs } from '../src/server/bestRecipes';
import type { BestRecipeResult } from '../src/server/bestRecipes';
import { loadAllFromCsv } from '../src/lib/loadFromCsv';
import { GCS_STATIC_BASE } from '../src/lib/config';
import type { Exchange, PriceType } from '../src/types';

// Volume classification URLs per exchange
// Currently all exchanges use ANT data. When exchange-specific files are available,
// update the URL for each exchange (e.g., CIS, ICA, NCC)
const VOLUME_CLASSIFICATION_URLS: Record<string, string> = {
  ANT: "https://storage.googleapis.com/prun-site-alpha-bucket/dynamic/production%20volume%20classification%20-%20ANT%20dynamic.csv",
  CIS: "https://storage.googleapis.com/prun-site-alpha-bucket/dynamic/production%20volume%20classification%20-%20ANT%20dynamic.csv", // TODO: Replace with CIS-specific file
  ICA: "https://storage.googleapis.com/prun-site-alpha-bucket/dynamic/production%20volume%20classification%20-%20ANT%20dynamic.csv", // TODO: Replace with ICA-specific file
  NCC: "https://storage.googleapis.com/prun-site-alpha-bucket/dynamic/production%20volume%20classification%20-%20ANT%20dynamic.csv", // TODO: Replace with NCC-specific file
  UNV: "https://storage.googleapis.com/prun-site-alpha-bucket/dynamic/production%20volume%20classification%20-%20ANT%20dynamic.csv", // TODO: Replace with UNV-specific file
};

/**
 * Fetch and parse a volume classification CSV, returning lookup maps by RecipeID and Ticker
 */
async function fetchVolumeClassification(url: string): Promise<{
  byRecipeId: Map<string, string>;
  byTicker: Map<string, string>;
}> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Volume classification fetch failed: ${res.status} ${res.statusText} for URL: ${url}`);
  }
  const text = await res.text();
  const rows: string[][] = parse(text, { skip_empty_lines: true });
  if (!rows.length) return { byRecipeId: new Map(), byTicker: new Map() };

  const [headers, ...data] = rows;
  const recipeIdIdx = headers.indexOf("RecipeID");
  const tickerIdx = headers.indexOf("Ticker");
  const classIdx = headers.indexOf("Volume Classification");

  const byRecipeId = new Map<string, string>();
  const byTicker = new Map<string, string>();

  for (const row of data) {
    const classification = classIdx !== -1 ? row[classIdx] : undefined;
    if (!classification) continue;
    if (recipeIdIdx !== -1 && row[recipeIdIdx]) {
      byRecipeId.set(row[recipeIdIdx], classification);
    }
    if (tickerIdx !== -1 && row[tickerIdx]) {
      byTicker.set(row[tickerIdx], classification);
    }
  }

  return { byRecipeId, byTicker };
}

/**
 * Append volume classification to best recipe results
 */
function appendVolumeData(
  data: BestRecipeResult[],
  volumeMap: { byRecipeId: Map<string, string>; byTicker: Map<string, string> }
): BestRecipeResult[] {
  return data.map((item) => {
    // Try matching by recipeId first, then fall back to ticker
    const volume =
      (item.recipeId ? volumeMap.byRecipeId.get(item.recipeId) : undefined) ??
      volumeMap.byTicker.get(item.ticker);
    return volume ? { ...item, volume } : item;
  });
}

// Exchange configurations
type ExchangeConfig = {
  outputName: string;      // File name identifier (e.g., "ANT-bid")
  exchange: Exchange;      // Actual exchange
  buyPriceType: PriceType; // Always "ask" for standard exchanges
  sellPriceType: PriceType; // bid/ask/pp7
};

// Standard exchanges with all sell price options (buy always at ask)
const STANDARD_EXCHANGES: Exchange[] = ["ANT", "CIS", "ICA", "NCC"];
const SELL_PRICE_TYPES: PriceType[] = ["bid", "ask", "pp7"];

const EXCHANGE_CONFIGS: ExchangeConfig[] = [
  // Generate all combinations for standard exchanges
  ...STANDARD_EXCHANGES.flatMap(exchange =>
    SELL_PRICE_TYPES.map(sellPriceType => ({
      outputName: `${exchange}-${sellPriceType}`,
      exchange,
      buyPriceType: "ask" as PriceType,
      sellPriceType
    }))
  ),
  // UNV special cases (not displayed in UI, but kept for compatibility)
  { outputName: "UNV7", exchange: "UNV", buyPriceType: "pp7", sellPriceType: "pp7" },
  { outputName: "UNV30", exchange: "UNV", buyPriceType: "pp30", sellPriceType: "pp30" },
];

async function generateBestRecipes() {
  console.log('Starting best recipes generation for all exchanges (standard + extraction modes)...');
  const overallStartTime = Date.now();

  try {
    // Ensure output directory exists
    const outputDir = join(process.cwd(), 'public', 'data');
    mkdirSync(outputDir, { recursive: true });

    // Fetch volume classification data per unique exchange (cached across configs)
    const uniqueExchanges = [...new Set(EXCHANGE_CONFIGS.map(c => c.exchange))];
    const volumeDataMap = new Map<string, { byRecipeId: Map<string, string>; byTicker: Map<string, string> }>();
    await Promise.all(
      uniqueExchanges.map(async (ex) => {
        const url = VOLUME_CLASSIFICATION_URLS[ex];
        if (!url) return;
        try {
          console.log(`Fetching volume classification for ${ex}...`);
          const volumeData = await fetchVolumeClassification(url);
          volumeDataMap.set(ex, volumeData);
          console.log(`✓ Volume classification for ${ex}: ${volumeData.byRecipeId.size} recipes, ${volumeData.byTicker.size} tickers`);
        } catch (err) {
          console.warn(`⚠ Could not fetch volume classification for ${ex}: ${err}`);
        }
      })
    );

    // Generate best recipes for all exchanges in parallel
    // For each config, generate both standard and extraction variants
    const outputNames = EXCHANGE_CONFIGS.map(c => c.outputName).join(', ');
    console.log(`Generating best recipes for ${EXCHANGE_CONFIGS.length} configurations × 2 modes = ${EXCHANGE_CONFIGS.length * 2} files`);
    console.log(`Configurations: ${outputNames}`);

    const results = await Promise.all(
      EXCHANGE_CONFIGS.flatMap((config) => {
        // Generate both standard and extraction modes for each config
        return ['standard', 'extraction'].map(async (mode) => {
          const modeLabel = mode === 'extraction' ? '-Extraction' : '';
          const startTime = Date.now();
          console.log(`\n[${config.outputName}${modeLabel}] Starting generation (exchange: ${config.exchange}, buy: ${config.buyPriceType}, sell: ${config.sellPriceType}, mode: ${mode})...`);

          let data;
          if (mode === 'extraction') {
            // Load standard recipes and prices from GCS
            const { GCS_DATA_SOURCES } = await import('../src/lib/config');
            const { recipeMap, pricesMap } = await loadAllFromCsv(
              { recipes: GCS_DATA_SOURCES.recipes, prices: GCS_DATA_SOURCES.prices },
              { bestMap: {} }
            );

            // Load expanded recipes for this exchange (if they exist)
            const expandedRecipeUrl = `${GCS_STATIC_BASE}/${config.exchange}-expandedrecipes-dynamic.csv`;

            try {
              console.log(`[${config.outputName}${modeLabel}] Loading expanded recipes from ${expandedRecipeUrl}...`);
              const expandedData = await loadAllFromCsv(
                { recipes: expandedRecipeUrl, prices: GCS_DATA_SOURCES.prices },
                { bestMap: {} }
              );

              // Strip "Planet" column to align with standard format (same logic as report.ts)
              const planetIndex = expandedData.recipeMap.headers.indexOf("Planet");
              if (planetIndex !== -1) {
                expandedData.recipeMap.headers.splice(planetIndex, 1);
                for (const recipes of Object.values(expandedData.recipeMap.map)) {
                  for (const recipe of recipes as any[]) {
                    recipe.splice(planetIndex, 1);
                  }
                }
              }

              // Merge expanded recipes into main recipeMap
              for (const [ticker, recipes] of Object.entries(expandedData.recipeMap.map)) {
                if (!recipeMap.map[ticker]) {
                  recipeMap.map[ticker] = [];
                }
                recipeMap.map[ticker].push(...(recipes as any[]));
              }

              console.log(`[${config.outputName}${modeLabel}] ✓ Merged expanded recipes`);
            } catch (err) {
              // If expanded recipes don't exist for this exchange, that's OK
              // The extraction variant will just match the standard variant
              console.log(`[${config.outputName}${modeLabel}] No expanded recipes found (will match standard)`);
            }

            // Generate best recipes with merged data
            data = await refreshBestRecipeIDs(
              "gcs",
              config.exchange,
              config.buyPriceType,
              config.sellPriceType,
              { recipeMap, pricesMap } // Pass pre-merged data
            );
          } else {
            // Standard mode: Use GCS prices for generation (aligns with production deployment)
            data = await refreshBestRecipeIDs("gcs", config.exchange, config.buyPriceType, config.sellPriceType);
          }

          // Append volume classification data
          const volumeMap = volumeDataMap.get(config.exchange);
          const enrichedData = volumeMap ? appendVolumeData(data, volumeMap) : data;

          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log(`[${config.outputName}${modeLabel}] ✓ Generated ${enrichedData.length} tickers in ${duration}s`);

          return { outputName: config.outputName, exchange: config.exchange, mode, data: enrichedData, duration };
        });
      })
    );

    // Write exchange-specific files (both standard and extraction variants)
    for (const { outputName, exchange, mode, data, duration } of results) {
      const modeLabel = mode === 'extraction' ? '-Extraction' : '';
      const outputPath = join(outputDir, `best-recipes-${outputName}${modeLabel}.json`);
      writeFileSync(outputPath, JSON.stringify(data, null, 2));

      const metaPath = join(outputDir, `best-recipes-${outputName}${modeLabel}-meta.json`);
      writeFileSync(metaPath, JSON.stringify({
        outputName: `${outputName}${modeLabel}`,
        exchange,
        mode,
        generatedAt: new Date().toISOString(),
        tickerCount: data.length,
        durationSeconds: parseFloat(duration)
      }, null, 2));

      console.log(`[${outputName}${modeLabel}] Written to ${outputPath}`);
    }

    // Write default file (ANT-bid standard mode) for backwards compatibility
    const antBidResult = results.find(r => r.outputName === "ANT-bid" && r.mode === "standard")!;
    const defaultPath = join(outputDir, 'best-recipes.json');
    writeFileSync(defaultPath, JSON.stringify(antBidResult.data, null, 2));

    const defaultMetaPath = join(outputDir, 'best-recipes-meta.json');
    writeFileSync(defaultMetaPath, JSON.stringify({
      exchange: "ANT",
      sellPriceType: "bid",
      mode: "standard",
      generatedAt: new Date().toISOString(),
      tickerCount: antBidResult.data.length,
      durationSeconds: parseFloat(antBidResult.duration)
    }, null, 2));

    console.log(`\n✓ Default files (ANT-bid standard) written to ${defaultPath}`);

    const overallDuration = ((Date.now() - overallStartTime) / 1000).toFixed(2);
    const totalFiles = EXCHANGE_CONFIGS.length * 2; // standard + extraction for each config
    console.log(`\n✅ Successfully generated best recipes for ${totalFiles} files (${EXCHANGE_CONFIGS.length} configs × 2 modes) in ${overallDuration}s`);

  } catch (error) {
    console.error('Error generating best recipes:', error);
    process.exit(1);
  }
}

generateBestRecipes();

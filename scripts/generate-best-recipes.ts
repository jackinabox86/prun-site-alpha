#!/usr/bin/env tsx
/**
 * Generate best recipes data at build time
 * This runs during deployment to pre-compute best recipe analysis
 * Generates data for all exchanges with all sell price options
 * Standard exchanges (ANT, CIS, ICA, NCC): bid, ask, pp7
 * UNV special cases: UNV7 (pp7), UNV30 (pp30) - not displayed in UI
 * Total: 12 standard + 2 UNV = 14 files
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { refreshBestRecipeIDs } from '../src/server/bestRecipes';
import type { Exchange, PriceType } from '../src/types';

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
  console.log('Starting best recipes generation for all exchanges...');
  const overallStartTime = Date.now();

  try {
    // Ensure output directory exists
    const outputDir = join(process.cwd(), 'public', 'data');
    mkdirSync(outputDir, { recursive: true });

    // Generate best recipes for all exchanges in parallel
    const outputNames = EXCHANGE_CONFIGS.map(c => c.outputName).join(', ');
    console.log(`Generating best recipes for ${EXCHANGE_CONFIGS.length} configurations: ${outputNames}`);

    const results = await Promise.all(
      EXCHANGE_CONFIGS.map(async (config) => {
        const startTime = Date.now();
        console.log(`\n[${config.outputName}] Starting generation (exchange: ${config.exchange}, buy: ${config.buyPriceType}, sell: ${config.sellPriceType})...`);

        // Use GCS prices for generation (aligns with production deployment)
        const data = await refreshBestRecipeIDs("gcs", config.exchange, config.buyPriceType, config.sellPriceType);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[${config.outputName}] ✓ Generated ${data.length} tickers in ${duration}s`);

        return { outputName: config.outputName, exchange: config.exchange, data, duration };
      })
    );

    // Write exchange-specific files
    for (const { outputName, exchange, data, duration } of results) {
      const outputPath = join(outputDir, `best-recipes-${outputName}.json`);
      writeFileSync(outputPath, JSON.stringify(data, null, 2));

      const metaPath = join(outputDir, `best-recipes-meta-${outputName}.json`);
      writeFileSync(metaPath, JSON.stringify({
        outputName,
        exchange,
        generatedAt: new Date().toISOString(),
        tickerCount: data.length,
        durationSeconds: parseFloat(duration)
      }, null, 2));

      console.log(`[${outputName}] Written to ${outputPath}`);
    }

    // Write default file (ANT-bid) for backwards compatibility
    const antBidResult = results.find(r => r.outputName === "ANT-bid")!;
    const defaultPath = join(outputDir, 'best-recipes.json');
    writeFileSync(defaultPath, JSON.stringify(antBidResult.data, null, 2));

    const defaultMetaPath = join(outputDir, 'best-recipes-meta.json');
    writeFileSync(defaultMetaPath, JSON.stringify({
      exchange: "ANT",
      sellPriceType: "bid",
      generatedAt: new Date().toISOString(),
      tickerCount: antBidResult.data.length,
      durationSeconds: parseFloat(antBidResult.duration)
    }, null, 2));

    console.log(`\n✓ Default files (ANT-bid) written to ${defaultPath}`);

    const overallDuration = ((Date.now() - overallStartTime) / 1000).toFixed(2);
    console.log(`\n✅ Successfully generated best recipes for all ${EXCHANGE_CONFIGS.length} configurations in ${overallDuration}s`);

  } catch (error) {
    console.error('Error generating best recipes:', error);
    process.exit(1);
  }
}

generateBestRecipes();

#!/usr/bin/env tsx
/**
 * Generate best recipes data at build time
 * This runs during deployment to pre-compute best recipe analysis
 * Generates data for all exchanges: ANT, CIS, ICA, NCC, UNV7, UNV30
 * Note: UNV is split into UNV7 (pp7 prices) and UNV30 (pp30 prices)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { refreshBestRecipeIDs } from '../src/server/bestRecipes';
import type { Exchange, PriceType } from '../src/types';

// Exchange configurations: [outputName, actualExchange, buyPriceType, sellPriceType]
type ExchangeConfig = {
  outputName: string;
  exchange: Exchange;
  buyPriceType: PriceType;
  sellPriceType: PriceType;
};

const EXCHANGE_CONFIGS: ExchangeConfig[] = [
  { outputName: "ANT", exchange: "ANT", buyPriceType: "ask", sellPriceType: "bid" },
  { outputName: "CIS", exchange: "CIS", buyPriceType: "ask", sellPriceType: "bid" },
  { outputName: "ICA", exchange: "ICA", buyPriceType: "ask", sellPriceType: "bid" },
  { outputName: "NCC", exchange: "NCC", buyPriceType: "ask", sellPriceType: "bid" },
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

    // Write default file (ANT) for backwards compatibility
    const antResult = results.find(r => r.exchange === "ANT")!;
    const defaultPath = join(outputDir, 'best-recipes.json');
    writeFileSync(defaultPath, JSON.stringify(antResult.data, null, 2));

    const defaultMetaPath = join(outputDir, 'best-recipes-meta.json');
    writeFileSync(defaultMetaPath, JSON.stringify({
      exchange: "ANT",
      generatedAt: new Date().toISOString(),
      tickerCount: antResult.data.length,
      durationSeconds: parseFloat(antResult.duration)
    }, null, 2));

    console.log(`\n✓ Default files (ANT) written to ${defaultPath}`);

    const overallDuration = ((Date.now() - overallStartTime) / 1000).toFixed(2);
    console.log(`\n✅ Successfully generated best recipes for all ${EXCHANGE_CONFIGS.length} configurations in ${overallDuration}s`);

  } catch (error) {
    console.error('Error generating best recipes:', error);
    process.exit(1);
  }
}

generateBestRecipes();

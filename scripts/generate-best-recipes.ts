#!/usr/bin/env tsx
/**
 * Generate best recipes data at build time
 * This runs during deployment to pre-compute best recipe analysis
 * Generates data for all 5 exchanges: ANT, CIS, ICA, NCC, UNV
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { refreshBestRecipeIDs } from '../src/server/bestRecipes';
import type { Exchange } from '../src/types';

const EXCHANGES: Exchange[] = ["ANT", "CIS", "ICA", "NCC", "UNV"];

async function generateBestRecipes() {
  console.log('Starting best recipes generation for all exchanges...');
  const overallStartTime = Date.now();

  try {
    // Ensure output directory exists
    const outputDir = join(process.cwd(), 'public', 'data');
    mkdirSync(outputDir, { recursive: true });

    // Generate best recipes for all exchanges in parallel
    console.log(`Generating best recipes for ${EXCHANGES.length} exchanges: ${EXCHANGES.join(', ')}`);

    const results = await Promise.all(
      EXCHANGES.map(async (exchange) => {
        const startTime = Date.now();
        console.log(`\n[${exchange}] Starting generation...`);

        // Use GCS prices for generation (aligns with production deployment)
        const data = await refreshBestRecipeIDs("gcs", exchange);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[${exchange}] ✓ Generated ${data.length} tickers in ${duration}s`);

        return { exchange, data, duration };
      })
    );

    // Write exchange-specific files
    for (const { exchange, data, duration } of results) {
      const outputPath = join(outputDir, `best-recipes-${exchange}.json`);
      writeFileSync(outputPath, JSON.stringify(data, null, 2));

      const metaPath = join(outputDir, `best-recipes-meta-${exchange}.json`);
      writeFileSync(metaPath, JSON.stringify({
        exchange,
        generatedAt: new Date().toISOString(),
        tickerCount: data.length,
        durationSeconds: parseFloat(duration)
      }, null, 2));

      console.log(`[${exchange}] Written to ${outputPath}`);
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
    console.log(`\n✅ Successfully generated best recipes for all ${EXCHANGES.length} exchanges in ${overallDuration}s`);

  } catch (error) {
    console.error('Error generating best recipes:', error);
    process.exit(1);
  }
}

generateBestRecipes();

#!/usr/bin/env tsx
/**
 * Generate best recipes data at build time
 * This runs during deployment to pre-compute best recipe analysis
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { refreshBestRecipeIDs } from '../src/server/bestRecipes';

async function generateBestRecipes() {
  console.log('Starting best recipes generation...');
  const startTime = Date.now();

  try {
    // Use GCS prices for generation (aligns with production deployment)
    console.log('Running refreshBestRecipeIDs with GCS prices...');
    const results = await refreshBestRecipeIDs("gcs");

    // Ensure output directory exists
    const outputDir = join(process.cwd(), 'public', 'data');
    mkdirSync(outputDir, { recursive: true });

    // Write results to public directory as static JSON
    const outputPath = join(outputDir, 'best-recipes.json');
    writeFileSync(outputPath, JSON.stringify(results, null, 2));

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Generated best recipes for ${results.length} tickers in ${duration}s`);
    console.log(`  Output: ${outputPath}`);

    // Write metadata
    const metaPath = join(outputDir, 'best-recipes-meta.json');
    writeFileSync(metaPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      tickerCount: results.length,
      durationSeconds: parseFloat(duration)
    }, null, 2));

  } catch (error) {
    console.error('Error generating best recipes:', error);
    process.exit(1);
  }
}

generateBestRecipes();

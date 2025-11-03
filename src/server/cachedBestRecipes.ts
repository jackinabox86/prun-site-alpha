// src/server/cachedBestRecipes.ts
import { refreshBestRecipeIDs, convertToBestMap, type BestRecipeResult } from "@/server/bestRecipes";
import type { BestMap, Exchange } from "@/types";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Cached best recipes singleton
 * Supports multiple exchanges and data sources (local/GCS)
 * Cache key format: `${priceSource}-${exchange}`
 * No fallbacks - fails fast if data source is unavailable
 */
class CachedBestRecipes {
  // Cache for results and maps, keyed by `${priceSource}-${exchange}`
  private cache: Map<string, { results: BestRecipeResult[]; bestMap: BestMap }> = new Map();
  private initPromises: Map<string, Promise<void>> = new Map();

  private getCacheKey(priceSource: "local" | "gcs", exchange: string): string {
    return `${priceSource}-${exchange}`;
  }

  /**
   * Get or load the best recipes and bestMap
   * @param priceSource - "local" for legacy static files, "gcs" for live GCS data (required)
   * @param exchange - Exchange to load (default: "ANT") - can also be "UNV7" or "UNV30"
   */
  async getBestRecipes(
    priceSource: "local" | "gcs",
    exchange: string = "ANT"
  ): Promise<{ results: BestRecipeResult[]; bestMap: BestMap }> {
    if (!priceSource) {
      throw new Error("priceSource is required - must be 'local' or 'gcs'");
    }

    const cacheKey = this.getCacheKey(priceSource, exchange);

    // Return cached data if available
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`Using cached ${priceSource} best recipes for ${exchange} (${cached.results.length} entries)`);
      return cached;
    }

    // If already initializing this combination, wait for that to complete
    const existingPromise = this.initPromises.get(cacheKey);
    if (existingPromise) {
      console.log(`Waiting for ongoing ${priceSource}/${exchange} best recipes load...`);
      await existingPromise;
      // Return the now-cached data
      return this.getCachedData(cacheKey);
    }

    // Start new initialization
    const initPromise = this.initialize(priceSource, exchange);
    this.initPromises.set(cacheKey, initPromise);
    await initPromise;
    this.initPromises.delete(cacheKey);

    return this.getCachedData(cacheKey);
  }

  private getCachedData(cacheKey: string): { results: BestRecipeResult[]; bestMap: BestMap } {
    const cached = this.cache.get(cacheKey);
    if (!cached) {
      throw new Error(`Best recipes not loaded for ${cacheKey}`);
    }
    return cached;
  }

  private async initialize(priceSource: "local" | "gcs", exchange: string): Promise<void> {
    const cacheKey = this.getCacheKey(priceSource, exchange);

    if (priceSource === "local") {
      const localData = await this.loadFromStaticFile(exchange);
      if (!localData) {
        throw new Error(
          `Failed to load local best recipes for ${exchange} from public/data/best-recipes-${exchange}.json. ` +
          "File may be missing or corrupted."
        );
      }
      const bestMap = convertToBestMap(localData.results);
      this.cache.set(cacheKey, { results: localData.results, bestMap });
      console.log(`Loaded local best recipes for ${exchange} (${localData.results.length} entries, generated: ${localData.generatedAt})`);
      return;
    }

    if (priceSource === "gcs") {
      // Get the actual URL that will be fetched for better error messages
      const { GCS_DATA_SOURCES } = await import("@/lib/config");
      const attemptedUrl = GCS_DATA_SOURCES.getBestRecipesForExchange(exchange);

      const gcsData = await this.loadFromGCS(exchange);
      if (!gcsData) {
        throw new Error(
          `Failed to load GCS best recipes for ${exchange}. ` +
          `Attempted to fetch: ${attemptedUrl}. ` +
          "Check that GCS_BEST_RECIPES_URL environment variable is set and the GCS bucket is accessible. " +
          "Verify the file exists and is publicly readable."
        );
      }
      const bestMap = convertToBestMap(gcsData.results);
      this.cache.set(cacheKey, { results: gcsData.results, bestMap });
      console.log(`Loaded GCS best recipes for ${exchange} (${gcsData.results.length} entries, generated: ${gcsData.generatedAt})`);
      return;
    }

    throw new Error(`Invalid priceSource: ${priceSource}. Must be 'local' or 'gcs'`);
  }

  /**
   * Try to load best recipes from Google Cloud Storage
   * Returns data and timestamp if successful, null otherwise
   */
  private async loadFromGCS(exchange: string): Promise<{ results: BestRecipeResult[]; generatedAt: string } | null> {
    try {
      const { GCS_DATA_SOURCES } = await import("@/lib/config");

      const url = GCS_DATA_SOURCES.getBestRecipesForExchange(exchange);
      console.log(`Fetching best recipes for ${exchange} from GCS: ${url}`);
      const response = await fetch(url, {
        cache: 'no-store', // Always get fresh data
      });

      if (!response.ok) {
        console.error(`GCS fetch failed for ${exchange}: ${response.status} ${response.statusText}`);
        console.error(`URL attempted: ${url}`);
        return null;
      }

      const text = await response.text();
      let results: BestRecipeResult[];

      try {
        results = JSON.parse(text) as BestRecipeResult[];
      } catch (parseError) {
        console.error(`Failed to parse GCS response as JSON. First 200 chars: ${text.substring(0, 200)}`);
        console.error(`Parse error:`, parseError);
        return null;
      }

      // Try to fetch metadata for timestamp
      const metaUrl = url.replace('.json', '-meta.json');
      let generatedAt = new Date(0).toISOString(); // Default to epoch if no metadata

      try {
        const metaResponse = await fetch(metaUrl, { cache: 'no-store' });
        if (metaResponse.ok) {
          const metaText = await metaResponse.text();
          try {
            const meta = JSON.parse(metaText);
            generatedAt = meta.generatedAt || generatedAt;
          } catch (metaParseError) {
            console.log(`GCS metadata parse failed, using default timestamp`);
          }
        }
      } catch (metaError) {
        // Metadata fetch failed, use default
        console.log(`GCS metadata fetch failed, using default timestamp`);
      }

      console.log(`Fetched ${results.length} best recipes for ${exchange} from GCS`);
      return { results, generatedAt };
    } catch (error) {
      console.log(`Error loading ${exchange} from GCS:`, error);
      return null;
    }
  }

  /**
   * Try to load best recipes from pre-generated static JSON file
   * Returns data and timestamp if successful, null otherwise
   */
  private async loadFromStaticFile(exchange: string): Promise<{ results: BestRecipeResult[]; generatedAt: string } | null> {
    try {
      const { LOCAL_DATA_SOURCES } = await import("@/lib/config");

      const staticFilePath = join(process.cwd(), LOCAL_DATA_SOURCES.getBestRecipesForExchange(exchange));

      if (!existsSync(staticFilePath)) {
        console.log(`Static file not found: ${staticFilePath}`);
        return null;
      }

      const fileContent = readFileSync(staticFilePath, 'utf-8');
      const results = JSON.parse(fileContent) as BestRecipeResult[];

      // Try to load metadata for timestamp
      let generatedAt = new Date(0).toISOString(); // Default to epoch if no metadata
      const metaFilePath = staticFilePath.replace('.json', '-meta.json');

      if (existsSync(metaFilePath)) {
        try {
          const meta = JSON.parse(readFileSync(metaFilePath, 'utf-8'));
          generatedAt = meta.generatedAt || generatedAt;
        } catch {
          // Metadata parse failed, use default
        }
      }

      console.log(`Loaded ${results.length} best recipes for ${exchange} from static file`);
      return { results, generatedAt };
    } catch (error) {
      console.error(`Error loading static best recipes file for ${exchange}:`, error);
      return null;
    }
  }

  /**
   * Clear the cache and force reload on next access
   * @param exchange - Optional exchange to clear. If not provided, clears all exchanges.
   */
  clearCache(exchange?: string): void {
    if (exchange) {
      // Clear specific exchange for both sources
      const localKey = this.getCacheKey("local", exchange);
      const gcsKey = this.getCacheKey("gcs", exchange);
      this.cache.delete(localKey);
      this.cache.delete(gcsKey);
      console.log(`Clearing best recipes cache for ${exchange}`);
    } else {
      // Clear all
      console.log("Clearing all best recipes cache");
      this.cache.clear();
    }
    this.initPromises.clear();
  }

  /**
   * Check if cache is populated for a given source and exchange
   */
  isCached(priceSource: "local" | "gcs", exchange: string = "ANT"): boolean {
    const cacheKey = this.getCacheKey(priceSource, exchange);
    return this.cache.has(cacheKey);
  }
}

// Export singleton instance
export const cachedBestRecipes = new CachedBestRecipes();

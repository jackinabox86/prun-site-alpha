// src/server/cachedBestRecipes.ts
import { convertToEnhancedBestMap, type BestRecipeResult, type EnhancedBestMap } from "@/server/bestRecipes";

/**
 * Cached best recipes singleton
 * Loads precomputed best-recipes JSON from GCS.
 * Cache key format: `${exchange}-${sellAt}-${mode}`
 * No fallbacks - fails fast if data source is unavailable
 */
class CachedBestRecipes {
  // Cache for results and maps, keyed by `${exchange}-${sellAt}-${mode}`
  private cache: Map<string, { results: BestRecipeResult[]; bestMap: EnhancedBestMap }> = new Map();
  private initPromises: Map<string, Promise<void>> = new Map();

  private getCacheKey(exchange: string, sellAt: string, mode: 'standard' | 'extraction'): string {
    return `${exchange}-${sellAt}-${mode}`;
  }

  /**
   * Get or load the best recipes and bestMap
   * @param exchange - Exchange to load (default: "ANT") - can also be "UNV7" or "UNV30"
   * @param sellAt - The sell price type (bid, ask, pp7) - defaults to 'bid'
   * @param mode - The recipe mode ('standard' or 'extraction') - defaults to 'standard'
   */
  async getBestRecipes(
    exchange: string = "ANT",
    sellAt: string = "bid",
    mode: 'standard' | 'extraction' = 'standard'
  ): Promise<{ results: BestRecipeResult[]; bestMap: EnhancedBestMap }> {
    const cacheKey = this.getCacheKey(exchange, sellAt, mode);

    // Return cached data if available
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`Using cached best recipes for ${exchange} with sellAt=${sellAt} mode=${mode} (${cached.results.length} entries)`);
      return cached;
    }

    // If already initializing this combination, wait for that to complete
    const existingPromise = this.initPromises.get(cacheKey);
    if (existingPromise) {
      console.log(`Waiting for ongoing ${exchange}/${sellAt}/${mode} best recipes load...`);
      await existingPromise;
      // Return the now-cached data
      return this.getCachedData(cacheKey);
    }

    // Start new initialization; always release the in-flight slot so a failed
    // load can be retried on the next request instead of rethrowing forever
    const initPromise = this.initialize(exchange, sellAt, mode);
    this.initPromises.set(cacheKey, initPromise);
    try {
      await initPromise;
    } finally {
      this.initPromises.delete(cacheKey);
    }

    return this.getCachedData(cacheKey);
  }

  private getCachedData(cacheKey: string): { results: BestRecipeResult[]; bestMap: EnhancedBestMap } {
    const cached = this.cache.get(cacheKey);
    if (!cached) {
      throw new Error(`Best recipes not loaded for ${cacheKey}`);
    }
    return cached;
  }

  private async initialize(exchange: string, sellAt: string, mode: 'standard' | 'extraction'): Promise<void> {
    const cacheKey = this.getCacheKey(exchange, sellAt, mode);

    // Get the actual URL that will be fetched for better error messages
    const { GCS_DATA_SOURCES } = await import("@/lib/config");
    const attemptedUrl = GCS_DATA_SOURCES.getBestRecipesForExchange(exchange, sellAt, mode);

    const gcsData = await this.loadFromGCS(exchange, sellAt, mode);
    if (!gcsData) {
      throw new Error(
        `Failed to load GCS best recipes for ${exchange} with sellAt=${sellAt} mode=${mode}. ` +
        `Attempted to fetch: ${attemptedUrl}. ` +
        "Check that GCS_BEST_RECIPES_URL environment variable is set and the GCS bucket is accessible. " +
        "Verify the file exists and is publicly readable."
      );
    }
    // Enhanced map keeps top3DisplayScenarios so the engine's diversity path
    // for deep children has the data it needs
    const bestMap = convertToEnhancedBestMap(gcsData.results);
    this.cache.set(cacheKey, { results: gcsData.results, bestMap });
    console.log(`Loaded GCS best recipes for ${exchange} with sellAt=${sellAt} mode=${mode} (${gcsData.results.length} entries, generated: ${gcsData.generatedAt})`);
  }

  /**
   * Try to load best recipes from Google Cloud Storage
   * Returns data and timestamp if successful, null otherwise
   */
  private async loadFromGCS(exchange: string, sellAt: string, mode: 'standard' | 'extraction'): Promise<{ results: BestRecipeResult[]; generatedAt: string } | null> {
    try {
      const { GCS_DATA_SOURCES } = await import("@/lib/config");

      const url = GCS_DATA_SOURCES.getBestRecipesForExchange(exchange, sellAt, mode);
      console.log(`Fetching best recipes for ${exchange} with sellAt=${sellAt} mode=${mode} from GCS: ${url}`);
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
   * Clear the cache and force reload on next access
   * @param exchange - Optional exchange to clear. If not provided, clears all exchanges.
   */
  clearCache(exchange?: string): void {
    if (exchange) {
      // Clear specific exchange for all sellAt options and both modes
      const sellAtOptions = ["bid", "ask", "pp7", "pp30"];
      const modes: ('standard' | 'extraction')[] = ['standard', 'extraction'];
      for (const sellAt of sellAtOptions) {
        for (const mode of modes) {
          this.cache.delete(this.getCacheKey(exchange, sellAt, mode));
        }
      }
      console.log(`Clearing best recipes cache for ${exchange} (all sell price options and modes)`);
    } else {
      // Clear all
      console.log("Clearing all best recipes cache");
      this.cache.clear();
    }
    this.initPromises.clear();
  }

  /**
   * Check if cache is populated for a given exchange, sellAt, and mode
   */
  isCached(exchange: string = "ANT", sellAt: string = "bid", mode: 'standard' | 'extraction' = 'standard'): boolean {
    return this.cache.has(this.getCacheKey(exchange, sellAt, mode));
  }
}

// Export singleton instance
export const cachedBestRecipes = new CachedBestRecipes();

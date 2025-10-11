// src/server/cachedBestRecipes.ts
import { refreshBestRecipeIDs, convertToBestMap, type BestRecipeResult } from "@/server/bestRecipes";
import type { BestMap } from "@/types";

/**
 * Cached best recipes singleton
 * Ensures best recipes are generated once and reused across all operations
 */
class CachedBestRecipes {
  private bestRecipeResults: BestRecipeResult[] | null = null;
  private bestMap: BestMap | null = null;
  private initPromise: Promise<void> | null = null;
  private isInitializing = false;

  /**
   * Get or generate the best recipes and bestMap
   * This will only run the generation once, subsequent calls return cached data
   */
  async getBestRecipes(): Promise<{ results: BestRecipeResult[]; bestMap: BestMap }> {
    // Return cached data if available
    if (this.bestRecipeResults && this.bestMap) {
      console.log(`Using cached best recipes (${this.bestRecipeResults.length} entries)`);
      return {
        results: this.bestRecipeResults,
        bestMap: this.bestMap,
      };
    }

    // If already initializing, wait for that to complete
    if (this.initPromise) {
      console.log("Waiting for ongoing best recipes generation...");
      await this.initPromise;
      return {
        results: this.bestRecipeResults!,
        bestMap: this.bestMap!,
      };
    }

    // Start new initialization
    this.initPromise = this.initialize();
    await this.initPromise;
    this.initPromise = null;

    return {
      results: this.bestRecipeResults!,
      bestMap: this.bestMap!,
    };
  }

  private async initialize(): Promise<void> {
    console.log("Generating best recipes (first run)...");
    const startTime = Date.now();

    this.bestRecipeResults = await refreshBestRecipeIDs();
    this.bestMap = convertToBestMap(this.bestRecipeResults);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Best recipes generated and cached: ${this.bestRecipeResults.length} entries in ${duration}s`);
  }

  /**
   * Clear the cache and force regeneration on next access
   */
  clearCache(): void {
    console.log("Clearing best recipes cache");
    this.bestRecipeResults = null;
    this.bestMap = null;
    this.initPromise = null;
    this.isInitializing = false;
  }

  /**
   * Check if cache is populated
   */
  isCached(): boolean {
    return this.bestRecipeResults !== null && this.bestMap !== null;
  }
}

// Export singleton instance
export const cachedBestRecipes = new CachedBestRecipes();

// src/server/cachedBestRecipes.ts
import { refreshBestRecipeIDs, convertToBestMap, type BestRecipeResult } from "@/server/bestRecipes";
import type { BestMap } from "@/types";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Cached best recipes singleton
 * Ensures best recipes are generated once and reused across all operations
 * Prefers pre-generated static data from build/GitHub Actions when available
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
    // Try to load from pre-generated static file first (fast path)
    const staticDataLoaded = this.loadFromStaticFile();

    if (staticDataLoaded) {
      console.log("Loaded best recipes from pre-generated static file");
      return;
    }

    // Fallback to runtime generation (slow path)
    console.log("No static data found, generating best recipes at runtime...");
    const startTime = Date.now();

    this.bestRecipeResults = await refreshBestRecipeIDs();
    this.bestMap = convertToBestMap(this.bestRecipeResults);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Best recipes generated and cached: ${this.bestRecipeResults.length} entries in ${duration}s`);
  }

  /**
   * Try to load best recipes from pre-generated static JSON file
   * Returns true if successful, false otherwise
   */
  private loadFromStaticFile(): boolean {
    try {
      // Path to the static file generated at build time or by GitHub Actions
      const staticFilePath = join(process.cwd(), 'public', 'data', 'best-recipes.json');

      if (!existsSync(staticFilePath)) {
        console.log("Static best-recipes.json not found");
        return false;
      }

      const fileContent = readFileSync(staticFilePath, 'utf-8');
      this.bestRecipeResults = JSON.parse(fileContent) as BestRecipeResult[];
      this.bestMap = convertToBestMap(this.bestRecipeResults);

      // Try to load metadata for logging
      const metaFilePath = join(process.cwd(), 'public', 'data', 'best-recipes-meta.json');
      if (existsSync(metaFilePath)) {
        const meta = JSON.parse(readFileSync(metaFilePath, 'utf-8'));
        console.log(`Loaded ${this.bestRecipeResults.length} best recipes from static file (generated: ${meta.generatedAt})`);
      } else {
        console.log(`Loaded ${this.bestRecipeResults.length} best recipes from static file`);
      }

      return true;
    } catch (error) {
      console.error("Error loading static best recipes file:", error);
      return false;
    }
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

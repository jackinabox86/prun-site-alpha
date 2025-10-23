// src/server/cachedBestRecipes.ts
import { refreshBestRecipeIDs, convertToBestMap, type BestRecipeResult } from "@/server/bestRecipes";
import type { BestMap } from "@/types";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Cached best recipes singleton
 * Separate caches for local (legacy) and GCS (live) data sources
 * No fallbacks - fails fast if data source is unavailable
 */
class CachedBestRecipes {
  // Separate caches for local and GCS sources
  private localResults: BestRecipeResult[] | null = null;
  private localMap: BestMap | null = null;
  private gcsResults: BestRecipeResult[] | null = null;
  private gcsMap: BestMap | null = null;
  private initPromises: Map<string, Promise<void>> = new Map();

  /**
   * Get or load the best recipes and bestMap
   * @param priceSource - "local" for legacy static files, "gcs" for live GCS data (required)
   */
  async getBestRecipes(priceSource: "local" | "gcs"): Promise<{ results: BestRecipeResult[]; bestMap: BestMap }> {
    if (!priceSource) {
      throw new Error("priceSource is required - must be 'local' or 'gcs'");
    }

    // Return cached data if available for this source
    if (priceSource === "local" && this.localResults && this.localMap) {
      console.log(`Using cached local best recipes (${this.localResults.length} entries)`);
      return { results: this.localResults, bestMap: this.localMap };
    }
    if (priceSource === "gcs" && this.gcsResults && this.gcsMap) {
      console.log(`Using cached GCS best recipes (${this.gcsResults.length} entries)`);
      return { results: this.gcsResults, bestMap: this.gcsMap };
    }

    // If already initializing this source, wait for that to complete
    const existingPromise = this.initPromises.get(priceSource);
    if (existingPromise) {
      console.log(`Waiting for ongoing ${priceSource} best recipes load...`);
      await existingPromise;
      // Return the now-cached data
      return this.getCachedData(priceSource);
    }

    // Start new initialization for this source
    const initPromise = this.initialize(priceSource);
    this.initPromises.set(priceSource, initPromise);
    await initPromise;
    this.initPromises.delete(priceSource);

    return this.getCachedData(priceSource);
  }

  private getCachedData(source: "local" | "gcs"): { results: BestRecipeResult[]; bestMap: BestMap } {
    if (source === "local") {
      if (!this.localResults || !this.localMap) {
        throw new Error("Local best recipes not loaded");
      }
      return { results: this.localResults, bestMap: this.localMap };
    }
    if (!this.gcsResults || !this.gcsMap) {
      throw new Error("GCS best recipes not loaded");
    }
    return { results: this.gcsResults, bestMap: this.gcsMap };
  }

  private async initialize(priceSource: "local" | "gcs"): Promise<void> {
    if (priceSource === "local") {
      const localData = await this.loadFromStaticFile();
      if (!localData) {
        throw new Error(
          "Failed to load local best recipes from public/data/best-recipes-315.json. " +
          "File may be missing or corrupted."
        );
      }
      this.localResults = localData.results;
      this.localMap = convertToBestMap(this.localResults);
      console.log(`Loaded local best recipes (${this.localResults.length} entries, generated: ${localData.generatedAt})`);
      return;
    }

    if (priceSource === "gcs") {
      const gcsData = await this.loadFromGCS();
      if (!gcsData) {
        throw new Error(
          "Failed to load GCS best recipes. " +
          "Check that GCS_BEST_RECIPES_URL environment variable is set and the GCS bucket is accessible. " +
          "URL should point to: https://storage.googleapis.com/prun-site-alpha-bucket/best-recipes.json"
        );
      }
      this.gcsResults = gcsData.results;
      this.gcsMap = convertToBestMap(this.gcsResults);
      console.log(`Loaded GCS best recipes (${this.gcsResults.length} entries, generated: ${gcsData.generatedAt})`);
      return;
    }

    throw new Error(`Invalid priceSource: ${priceSource}. Must be 'local' or 'gcs'`);
  }

  /**
   * Try to load best recipes from Google Cloud Storage
   * Returns data and timestamp if successful, null otherwise
   */
  private async loadFromGCS(): Promise<{ results: BestRecipeResult[]; generatedAt: string } | null> {
    try {
      const { GCS_DATA_SOURCES } = await import("@/lib/config");

      const url = GCS_DATA_SOURCES.bestRecipes;
      console.log(`Fetching best recipes from GCS: ${url}`);
      const response = await fetch(url, {
        cache: 'no-store', // Always get fresh data
      });

      if (!response.ok) {
        console.log(`GCS fetch failed: ${response.status} ${response.statusText}`);
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

      console.log(`Fetched ${results.length} best recipes from GCS`);
      return { results, generatedAt };
    } catch (error) {
      console.log("Error loading from GCS:", error);
      return null;
    }
  }

  /**
   * Try to load best recipes from pre-generated static JSON file
   * Returns data and timestamp if successful, null otherwise
   */
  private async loadFromStaticFile(): Promise<{ results: BestRecipeResult[]; generatedAt: string } | null> {
    try {
      const { LOCAL_DATA_SOURCES } = await import("@/lib/config");

      const staticFilePath = join(process.cwd(), LOCAL_DATA_SOURCES.bestRecipes);

      if (!existsSync(staticFilePath)) {
        console.log(`Static file not found: ${staticFilePath}`);
        return null;
      }

      const fileContent = readFileSync(staticFilePath, 'utf-8');
      const results = JSON.parse(fileContent) as BestRecipeResult[];

      // Try to load metadata for timestamp
      let generatedAt = new Date(0).toISOString(); // Default to epoch if no metadata
      const metaFilePath = join(process.cwd(), LOCAL_DATA_SOURCES.bestRecipesMeta);

      if (existsSync(metaFilePath)) {
        try {
          const meta = JSON.parse(readFileSync(metaFilePath, 'utf-8'));
          generatedAt = meta.generatedAt || generatedAt;
        } catch {
          // Metadata parse failed, use default
        }
      }

      console.log(`Loaded ${results.length} best recipes from static file`);
      return { results, generatedAt };
    } catch (error) {
      console.error("Error loading static best recipes file:", error);
      return null;
    }
  }

  /**
   * Clear the cache and force reload on next access
   */
  clearCache(): void {
    console.log("Clearing best recipes cache");
    this.localResults = null;
    this.localMap = null;
    this.gcsResults = null;
    this.gcsMap = null;
    this.initPromises.clear();
  }

  /**
   * Check if cache is populated for a given source
   */
  isCached(priceSource: "local" | "gcs"): boolean {
    if (priceSource === "local") return this.localResults !== null && this.localMap !== null;
    if (priceSource === "gcs") return this.gcsResults !== null && this.gcsMap !== null;
    return false;
  }
}

// Export singleton instance
export const cachedBestRecipes = new CachedBestRecipes();

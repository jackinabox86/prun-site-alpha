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
  // Separate caches for local and GCS sources
  private localResults: BestRecipeResult[] | null = null;
  private localMap: BestMap | null = null;
  private gcsResults: BestRecipeResult[] | null = null;
  private gcsMap: BestMap | null = null;
  private autoResults: BestRecipeResult[] | null = null;
  private autoMap: BestMap | null = null;
  private initPromises: Map<string, Promise<void>> = new Map();

  /**
   * Get or generate the best recipes and bestMap
   * This will cache data per priceSource to support switching between local and GCS
   * @param priceSource - "local" to prefer local file, "gcs" to prefer GCS, undefined for auto (newest)
   */
  async getBestRecipes(priceSource?: "local" | "gcs"): Promise<{ results: BestRecipeResult[]; bestMap: BestMap }> {
    const source = priceSource || "auto";

    // Return cached data if available for this source
    if (source === "local" && this.localResults && this.localMap) {
      console.log(`Using cached local best recipes (${this.localResults.length} entries)`);
      return { results: this.localResults, bestMap: this.localMap };
    }
    if (source === "gcs" && this.gcsResults && this.gcsMap) {
      console.log(`Using cached GCS best recipes (${this.gcsResults.length} entries)`);
      return { results: this.gcsResults, bestMap: this.gcsMap };
    }
    if (source === "auto" && this.autoResults && this.autoMap) {
      console.log(`Using cached auto best recipes (${this.autoResults.length} entries)`);
      return { results: this.autoResults, bestMap: this.autoMap };
    }

    // If already initializing this source, wait for that to complete
    const existingPromise = this.initPromises.get(source);
    if (existingPromise) {
      console.log(`Waiting for ongoing ${source} best recipes generation...`);
      await existingPromise;
      // Return the now-cached data
      return this.getCachedData(source);
    }

    // Start new initialization for this source
    const initPromise = this.initialize(priceSource);
    this.initPromises.set(source, initPromise);
    await initPromise;
    this.initPromises.delete(source);

    return this.getCachedData(source);
  }

  private getCachedData(source: string): { results: BestRecipeResult[]; bestMap: BestMap } {
    if (source === "local") return { results: this.localResults!, bestMap: this.localMap! };
    if (source === "gcs") return { results: this.gcsResults!, bestMap: this.gcsMap! };
    return { results: this.autoResults!, bestMap: this.autoMap! };
  }

  private async initialize(priceSource?: "local" | "gcs"): Promise<void> {
    // Try to load from both GCS and local file
    const [gcsData, localData] = await Promise.all([
      this.loadFromGCS(),
      this.loadFromStaticFile(priceSource),
    ]);

    // If priceSource is specified, store in the appropriate cache
    if (priceSource === "local" && localData) {
      this.localResults = localData.results;
      this.localMap = convertToBestMap(this.localResults);
      console.log(`Loaded local best recipes (${this.localResults.length} entries, generated: ${localData.generatedAt})`);
      return;
    }

    if (priceSource === "gcs" && gcsData) {
      this.gcsResults = gcsData.results;
      this.gcsMap = convertToBestMap(this.gcsResults);
      console.log(`Loaded GCS best recipes (${this.gcsResults.length} entries, generated: ${gcsData.generatedAt})`);
      return;
    }

    // Auto mode: compare timestamps and use fresher data
    if (gcsData && localData) {
      const gcsTimestamp = new Date(gcsData.generatedAt || 0).getTime();
      const localTimestamp = new Date(localData.generatedAt || 0).getTime();

      if (gcsTimestamp >= localTimestamp) {
        this.autoResults = gcsData.results;
        this.autoMap = convertToBestMap(this.autoResults);
        console.log(`Using GCS data (generated: ${gcsData.generatedAt}, newer than local: ${localData.generatedAt})`);
      } else {
        this.autoResults = localData.results;
        this.autoMap = convertToBestMap(this.autoResults);
        console.log(`Using local data (generated: ${localData.generatedAt}, newer than GCS: ${gcsData.generatedAt})`);
      }
      return;
    }

    // Use whichever source succeeded (for auto mode or if preferred source failed)
    const source = priceSource || "auto";

    if (source === "gcs" && gcsData) {
      this.gcsResults = gcsData.results;
      this.gcsMap = convertToBestMap(this.gcsResults);
      console.log(`Loaded ${this.gcsResults.length} best recipes from GCS (generated: ${gcsData.generatedAt})`);
      return;
    }

    if (source === "local" && localData) {
      this.localResults = localData.results;
      this.localMap = convertToBestMap(this.localResults);
      console.log(`Loaded ${this.localResults.length} best recipes from local (generated: ${localData.generatedAt})`);
      return;
    }

    if (gcsData) {
      this.autoResults = gcsData.results;
      this.autoMap = convertToBestMap(this.autoResults);
      console.log(`Loaded ${this.autoResults.length} best recipes from GCS (generated: ${gcsData.generatedAt})`);
      return;
    }

    if (localData) {
      this.autoResults = localData.results;
      this.autoMap = convertToBestMap(this.autoResults);
      console.warn(`⚠️ ALERT: GCS failed, falling back to local file (generated: ${localData.generatedAt})`);
      console.warn(`⚠️ Check GCS bucket and network connectivity`);
      return;
    }

    // Fallback to runtime generation (slow path)
    console.error("🚨 ALERT: Both GCS and local file failed!");
    console.error("🚨 Generating best recipes at runtime (slow, ~7 seconds)...");
    console.error("🚨 Check GCS bucket, local file, and build process");
    const startTime = Date.now();

    const generated = await refreshBestRecipeIDs();
    const generatedMap = convertToBestMap(generated);

    // Store in the appropriate cache
    if (source === "local") {
      this.localResults = generated;
      this.localMap = generatedMap;
    } else if (source === "gcs") {
      this.gcsResults = generated;
      this.gcsMap = generatedMap;
    } else {
      this.autoResults = generated;
      this.autoMap = generatedMap;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Best recipes generated and cached: ${generated.length} entries in ${duration}s`);
  }

  /**
   * Try to load best recipes from Google Cloud Storage
   * Returns data and timestamp if successful, null otherwise
   */
  private async loadFromGCS(): Promise<{ results: BestRecipeResult[]; generatedAt: string } | null> {
    try {
      const { BEST_RECIPES_URL } = await import("@/lib/config");

      // Skip if URL points to local file
      if (!BEST_RECIPES_URL.startsWith('http')) {
        return null;
      }

      console.log(`Fetching best recipes from GCS: ${BEST_RECIPES_URL}`);
      const response = await fetch(BEST_RECIPES_URL, {
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
      const metaUrl = BEST_RECIPES_URL.replace('.json', '-meta.json');
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
  private async loadFromStaticFile(priceSource?: "local" | "gcs"): Promise<{ results: BestRecipeResult[]; generatedAt: string } | null> {
    try {
      // Use -315 backup files for local mode to preserve 315-ticker version
      const fileSuffix = priceSource === "local" ? "-315" : "";
      const staticFilePath = join(process.cwd(), 'public', 'data', `best-recipes${fileSuffix}.json`);

      if (!existsSync(staticFilePath)) {
        console.log(`Static best-recipes${fileSuffix}.json not found`);
        return null;
      }

      const fileContent = readFileSync(staticFilePath, 'utf-8');
      const results = JSON.parse(fileContent) as BestRecipeResult[];

      // Try to load metadata for timestamp
      let generatedAt = new Date(0).toISOString(); // Default to epoch if no metadata
      const metaFilePath = join(process.cwd(), 'public', 'data', `best-recipes-meta${fileSuffix}.json`);

      if (existsSync(metaFilePath)) {
        try {
          const meta = JSON.parse(readFileSync(metaFilePath, 'utf-8'));
          generatedAt = meta.generatedAt || generatedAt;
        } catch {
          // Metadata parse failed, use default
        }
      }

      console.log(`Loaded ${results.length} best recipes from static file (${fileSuffix || "default"})`);
      return { results, generatedAt };
    } catch (error) {
      console.error("Error loading static best recipes file:", error);
      return null;
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

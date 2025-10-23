/**
 * Local data sources - uses legacy static files from public/data
 * These are frozen snapshots for testing/comparison purposes
 */
export const LOCAL_DATA_SOURCES = {
  recipes: "public/data/recipes-legacy.csv",
  prices: "public/data/prices-legacy.csv",
  bestRecipes: "public/data/best-recipes-315.json",
  bestRecipesMeta: "public/data/best-recipes-meta-315.json",
} as const;

/**
 * GCS data sources - requires environment variables to be set
 * Throws explicit errors if environment variables are missing
 */
export const GCS_DATA_SOURCES = {
  get recipes(): string {
    if (!process.env.GCS_RECIPES_URL) {
      throw new Error("GCS_RECIPES_URL environment variable is not set. Required for GCS mode.");
    }
    return process.env.GCS_RECIPES_URL;
  },
  get prices(): string {
    if (!process.env.GCS_PRICES_URL) {
      throw new Error("GCS_PRICES_URL environment variable is not set. Required for GCS mode.");
    }
    return process.env.GCS_PRICES_URL;
  },
  get bestRecipes(): string {
    if (!process.env.GCS_BEST_RECIPES_URL) {
      throw new Error("GCS_BEST_RECIPES_URL environment variable is not set. Required for GCS mode.");
    }
    return process.env.GCS_BEST_RECIPES_URL;
  },
} as const;

/**
 * @deprecated Use LOCAL_DATA_SOURCES or GCS_DATA_SOURCES instead
 * Legacy config maintained for backwards compatibility during migration
 */
export const CSV_URLS = {
  recipes: process.env.GCS_RECIPES_URL || LOCAL_DATA_SOURCES.recipes,
  prices: process.env.GCS_PRICES_URL || LOCAL_DATA_SOURCES.prices,
};

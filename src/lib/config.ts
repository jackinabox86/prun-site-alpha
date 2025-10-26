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
 * Determine if we should use test files based on environment
 * Uses -test suffix for preview deployments (non-production branches)
 */
function getFileSuffix(): string {
  // In production (main branch), use no suffix
  // In preview deployments (other branches), use -test suffix
  const isProduction = process.env.VERCEL_ENV === 'production' ||
                       process.env.VERCEL_GIT_COMMIT_REF === 'main';
  return isProduction ? '' : '-test';
}

/**
 * GCS data sources - requires environment variables to be set
 * Automatically uses -test suffix for preview deployments
 * Throws explicit errors if environment variables are missing
 */
export const GCS_DATA_SOURCES = {
  get recipes(): string {
    const baseUrl = process.env.GCS_RECIPES_URL;
    if (!baseUrl) {
      throw new Error("GCS_RECIPES_URL environment variable is not set. Required for GCS mode.");
    }
    const suffix = getFileSuffix();
    // Replace .csv with -test.csv if needed
    return suffix ? baseUrl.replace('.csv', `${suffix}.csv`) : baseUrl;
  },
  get prices(): string {
    const baseUrl = process.env.GCS_PRICES_URL;
    if (!baseUrl) {
      throw new Error("GCS_PRICES_URL environment variable is not set. Required for GCS mode.");
    }
    const suffix = getFileSuffix();
    return suffix ? baseUrl.replace('.csv', `${suffix}.csv`) : baseUrl;
  },
  get bestRecipes(): string {
    const baseUrl = process.env.GCS_BEST_RECIPES_URL;
    if (!baseUrl) {
      throw new Error("GCS_BEST_RECIPES_URL environment variable is not set. Required for GCS mode.");
    }
    const suffix = getFileSuffix();
    return suffix ? baseUrl.replace('.json', `${suffix}.json`) : baseUrl;
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

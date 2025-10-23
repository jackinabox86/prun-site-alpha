// Support both remote URLs and local file paths
export const CSV_URLS = {
  recipes: process.env.BLOB_RECIPES_URL || "public/data/recipes.csv",
  prices:  process.env.BLOB_PRICES_URL || "public/data/prices.csv",
  // best: removed - now generated dynamically via bestRecipes.ts
};

// Google Cloud Storage URL for best recipes data
// Falls back to local file if not set
export const BEST_RECIPES_URL =
  process.env.GCS_BEST_RECIPES_URL ||
  "https://storage.googleapis.com/prun-site-alpha-bucket/best-recipes.json";

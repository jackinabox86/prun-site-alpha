// Support both remote URLs (GCS) and local file paths
export const CSV_URLS = {
  recipes: process.env.GCS_RECIPES_URL || "public/data/recipes.csv",
  prices:  process.env.GCS_PRICES_URL || "public/data/prices.csv",
  // best: removed - now generated dynamically via bestRecipes.ts
};

// Google Cloud Storage URLs
export const GCS_PRICES_URL = "https://storage.googleapis.com/prun-site-alpha-bucket/prices.csv";

export const BEST_RECIPES_URL =
  process.env.GCS_BEST_RECIPES_URL ||
  "https://storage.googleapis.com/prun-site-alpha-bucket/best-recipes.json";

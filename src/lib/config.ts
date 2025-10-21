// Support both Vercel Blob URLs and local file paths
export const CSV_URLS = {
  recipes: process.env.BLOB_RECIPES_URL || "public/data/recipes.csv",
  prices:  process.env.BLOB_PRICES_URL || "public/data/prices.csv",
  // best: removed - now generated dynamically via bestRecipes.ts
};

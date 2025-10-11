export const CSV_URLS = {
  recipes: process.env.BLOB_RECIPES_URL || "",
  prices:  process.env.BLOB_PRICES_URL || "",
  // best: removed - now generated dynamically via bestRecipes.ts
};

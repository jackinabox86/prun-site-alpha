// src/core/aemChainBuilder.ts
// Client-side MAKE-only production chain builder for AEM Visualizer

export interface RecipeInput {
  ticker: string;
  amount: number;
}

export interface RecipeOutput {
  ticker: string;
  amount: number;
}

export interface Recipe {
  recipeId: string;
  building: string;
  inputs: RecipeInput[];
  outputs: RecipeOutput[];
}

export type RecipeMap = Record<string, Recipe[]>;

export interface ChainNode {
  id: string;             // Unique node ID for Sankey
  ticker: string;
  recipeId: string | null;
  building: string | null;
  depth: number;
  isError?: boolean;
  errorMessage?: string;
  inputs: ChainInput[];
}

export interface ChainInput {
  ticker: string;
  amount: number;
  childNode: ChainNode | null;
}

export interface ChainResult {
  root: ChainNode | null;
  error: string | null;
  circularDependency: boolean;
}

const MAX_DEPTH = 8;

/**
 * Parse forced recipe IDs from comma-separated string
 * Returns a Map of ticker -> recipeId
 */
export function parseForceRecipes(forceRecipeStr: string): Map<string, string> {
  const forceMap = new Map<string, string>();
  if (!forceRecipeStr.trim()) return forceMap;

  const parts = forceRecipeStr.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  for (const recipeId of parts) {
    // Recipe IDs are in format TICKER_N (e.g., C_5, HCP_2)
    const underscoreIdx = recipeId.lastIndexOf("_");
    if (underscoreIdx > 0) {
      const ticker = recipeId.substring(0, underscoreIdx);
      forceMap.set(ticker, recipeId);
    }
  }
  return forceMap;
}

/**
 * Select the recipe to use for a given ticker
 * Priority:
 * 1. Forced recipe (if specified)
 * 2. First available recipe (default)
 */
function selectRecipe(
  ticker: string,
  recipes: Recipe[],
  forceRecipes: Map<string, string>
): Recipe | null {
  if (!recipes || recipes.length === 0) return null;

  // Check if a specific recipe is forced
  const forcedRecipeId = forceRecipes.get(ticker);
  if (forcedRecipeId) {
    const forced = recipes.find((r) => r.recipeId.toUpperCase() === forcedRecipeId);
    if (forced) return forced;
    // If forced recipe not found, fall through to default
  }

  // Default: use first available recipe
  return recipes[0];
}

/**
 * Build a production chain tree with MAKE-only decisions
 */
export function buildProductionChain(
  ticker: string,
  recipeMap: RecipeMap,
  forceRecipes: Map<string, string>,
  visited: Set<string> = new Set(),
  depth: number = 0
): ChainNode {
  const nodeId = `${ticker}::${depth}::${visited.size}`;

  // Check for max depth
  if (depth > MAX_DEPTH) {
    return {
      id: nodeId,
      ticker,
      recipeId: null,
      building: null,
      depth,
      isError: true,
      errorMessage: "Max depth exceeded",
      inputs: [],
    };
  }

  // Check for circular dependency
  if (visited.has(ticker)) {
    return {
      id: nodeId,
      ticker,
      recipeId: null,
      building: null,
      depth,
      isError: true,
      errorMessage: "Circular dependency detected",
      inputs: [],
    };
  }

  const recipes = recipeMap[ticker];
  if (!recipes || recipes.length === 0) {
    // No recipe found - this is a raw material or missing recipe
    return {
      id: nodeId,
      ticker,
      recipeId: null,
      building: null,
      depth,
      isError: true,
      errorMessage: "No recipe found (raw material or missing)",
      inputs: [],
    };
  }

  const recipe = selectRecipe(ticker, recipes, forceRecipes);
  if (!recipe) {
    return {
      id: nodeId,
      ticker,
      recipeId: null,
      building: null,
      depth,
      isError: true,
      errorMessage: "Recipe selection failed",
      inputs: [],
    };
  }

  // Add to visited set for this branch
  const newVisited = new Set(visited);
  newVisited.add(ticker);

  // Build child nodes for each input
  const inputs: ChainInput[] = recipe.inputs.map((input) => {
    const childNode = buildProductionChain(
      input.ticker,
      recipeMap,
      forceRecipes,
      newVisited,
      depth + 1
    );

    return {
      ticker: input.ticker,
      amount: input.amount,
      childNode,
    };
  });

  return {
    id: nodeId,
    ticker,
    recipeId: recipe.recipeId,
    building: recipe.building,
    depth,
    inputs,
  };
}

/**
 * Main entry point to build the chain
 */
export function buildChain(
  ticker: string,
  recipeMap: RecipeMap,
  forceRecipeStr: string
): ChainResult {
  if (!ticker) {
    return { root: null, error: "No ticker specified", circularDependency: false };
  }

  const forceRecipes = parseForceRecipes(forceRecipeStr);

  try {
    const root = buildProductionChain(ticker, recipeMap, forceRecipes);

    // Check if there was a circular dependency anywhere
    const hasCircular = checkForCircular(root);

    return {
      root,
      error: null,
      circularDependency: hasCircular,
    };
  } catch (err: any) {
    return {
      root: null,
      error: err?.message ?? "Unknown error building chain",
      circularDependency: false,
    };
  }
}

/**
 * Check if any node in the tree has a circular dependency error
 */
function checkForCircular(node: ChainNode): boolean {
  if (node.errorMessage?.includes("Circular")) return true;

  for (const input of node.inputs) {
    if (input.childNode && checkForCircular(input.childNode)) {
      return true;
    }
  }

  return false;
}

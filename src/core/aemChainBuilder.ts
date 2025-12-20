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
  outputAmount: number;   // How many units this recipe produces per run
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

export interface MaterialEntry {
  ticker: string;
  totalAmount: number;
  isRawMaterial: boolean;
  building: string | null;
  recipeId: string | null;
  depth: number;
}

const MAX_DEPTH = 20;

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
      outputAmount: 1,
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
      outputAmount: 1,
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
      outputAmount: 1,
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
      outputAmount: 1,
      depth,
      isError: true,
      errorMessage: "Recipe selection failed",
      inputs: [],
    };
  }

  // Get the output amount for this ticker from the recipe
  const outputForTicker = recipe.outputs.find((o) => o.ticker === ticker);
  const outputAmount = outputForTicker?.amount ?? 1;

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
    outputAmount,
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

/**
 * Calculate the total materials list from a production chain
 * Recursively traverses the tree, accumulating quantities with proper scaling.
 *
 * The key formula is: childUnitsNeeded = (parentUnitsNeeded / parentOutputAmount) * inputAmountPerRun
 * Example: If we need 20 BCO and BCO recipe outputs 10 per run and needs 300 PE per run:
 *   runsNeeded = 20 / 10 = 2, so PE needed = 2 * 300 = 600
 */
export function calculateMaterialsList(chain: ChainNode): MaterialEntry[] {
  const materialsMap = new Map<string, MaterialEntry>();

  // unitsNeeded: how many units of this node's output are needed
  function traverse(node: ChainNode, unitsNeeded: number): void {
    // Calculate how many runs of this recipe we need
    const runsNeeded = unitsNeeded / node.outputAmount;

    for (const input of node.inputs) {
      // How many units of this input material we need
      const childUnitsNeeded = runsNeeded * input.amount;
      const childNode = input.childNode;

      if (childNode) {
        const existing = materialsMap.get(childNode.ticker);
        const isRaw = childNode.recipeId === null;

        if (existing) {
          existing.totalAmount += childUnitsNeeded;
          // Keep the deepest depth
          if (childNode.depth > existing.depth) {
            existing.depth = childNode.depth;
          }
        } else {
          materialsMap.set(childNode.ticker, {
            ticker: childNode.ticker,
            totalAmount: childUnitsNeeded,
            isRawMaterial: isRaw,
            building: childNode.building,
            recipeId: childNode.recipeId,
            depth: childNode.depth,
          });
        }

        // Recursively traverse child inputs with the units needed of that child
        traverse(childNode, childUnitsNeeded);
      }
    }
  }

  // Start traversal: we need 1 unit of the root ticker
  traverse(chain, 1);

  // Convert map to array and sort alphabetically by ticker
  return Array.from(materialsMap.values()).sort((a, b) =>
    a.ticker.localeCompare(b.ticker)
  );
}

/**
 * Material ticker configuration for historical price fetching
 *
 * Organized by category for easier basket selection later.
 * Add or remove tickers as needed.
 */

export interface MaterialConfig {
  ticker: string;
  category: string;
  priority?: "high" | "medium" | "low"; // For basket selection
}

// All materials organized by category
export const MATERIALS: MaterialConfig[] = [
  // === Consumables ===
  { ticker: "RAT", category: "Consumables", priority: "high" },
  { ticker: "DW", category: "Consumables", priority: "high" },
  { ticker: "OVE", category: "Consumables", priority: "medium" },
  { ticker: "EXO", category: "Consumables", priority: "medium" },
  { ticker: "PT", category: "Consumables", priority: "medium" },

  // === Basic Materials ===
  { ticker: "FE", category: "Materials", priority: "high" },
  { ticker: "AL", category: "Materials", priority: "high" },
  { ticker: "O", category: "Materials", priority: "high" },
  { ticker: "H2O", category: "Materials", priority: "high" },
  { ticker: "C", category: "Materials", priority: "high" },
  { ticker: "SI", category: "Materials", priority: "medium" },
  { ticker: "CU", category: "Materials", priority: "medium" },
  { ticker: "MG", category: "Materials", priority: "medium" },

  // === Processed Materials ===
  { ticker: "PE", category: "Processed", priority: "medium" },
  { ticker: "BSE", category: "Processed", priority: "medium" },
  { ticker: "LST", category: "Processed", priority: "medium" },
  { ticker: "MCG", category: "Processed", priority: "medium" },
  { ticker: "STL", category: "Processed", priority: "high" },
  { ticker: "BTA", category: "Processed", priority: "medium" },
  { ticker: "FLX", category: "Processed", priority: "medium" },

  // === Construction Materials ===
  { ticker: "AEF", category: "Construction", priority: "medium" },
  { ticker: "BBH", category: "Construction", priority: "medium" },
  { ticker: "BDE", category: "Construction", priority: "medium" },
  { ticker: "BL", category: "Construction", priority: "medium" },
  { ticker: "BSC", category: "Construction", priority: "medium" },
  { ticker: "MHL", category: "Construction", priority: "medium" },
  { ticker: "RSI", category: "Construction", priority: "medium" },
  { ticker: "SEA", category: "Construction", priority: "medium" },
  { ticker: "TRU", category: "Construction", priority: "medium" },
  { ticker: "TSH", category: "Construction", priority: "medium" },

  // === Electronics ===
  { ticker: "MPC", category: "Electronics", priority: "medium" },
  { ticker: "LDE", category: "Electronics", priority: "low" },
  { ticker: "PSL", category: "Electronics", priority: "low" },
  { ticker: "TCL", category: "Electronics", priority: "low" },

  // Add more materials as needed...
  // You can find the full list in your recipes or materials data
];

// Helper functions
export function getMaterialsByCategory(category: string): MaterialConfig[] {
  return MATERIALS.filter((m) => m.category === category);
}

export function getMaterialsByPriority(priority: "high" | "medium" | "low"): MaterialConfig[] {
  return MATERIALS.filter((m) => m.priority === priority);
}

export function getHighPriorityMaterials(): MaterialConfig[] {
  return MATERIALS.filter((m) => m.priority === "high");
}

export function getAllTickers(): string[] {
  return MATERIALS.map((m) => m.ticker);
}

// Predefined material baskets for different inflation indices
export const BASKETS = {
  // High-liquidity essentials (for primary inflation index)
  essentials: [
    "RAT",
    "DW",
    "FE",
    "AL",
    "O",
    "H2O",
    "C",
    "STL",
    "PE",
    "BSE",
  ],

  // Consumables-focused basket
  consumables: ["RAT", "DW", "OVE", "EXO", "PT"],

  // Construction materials basket
  construction: ["AEF", "BBH", "BDE", "BL", "BSC", "MHL", "RSI", "SEA", "TRU", "TSH"],

  // Basic materials basket
  basicMaterials: ["FE", "AL", "O", "H2O", "C", "SI", "CU", "MG"],

  // Full basket (all high + medium priority)
  comprehensive: MATERIALS.filter(
    (m) => m.priority === "high" || m.priority === "medium"
  ).map((m) => m.ticker),
};

// src/core/scenario.ts

/** Canonical string normalization used for comparisons */
export function normalizeScenario(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Compose scenario names exactly like your Apps Script did */
export function composeScenario(
  prev: string,
  branch: { type: "BUY" | "MAKE"; inputTicker: string; recipeLabel?: string | null; childScenario?: string }
): string {
  const base = prev && prev.length ? prev + " | " : "";

  if (branch.type === "BUY") {
    // "Buy X"
    return base + `Buy ${branch.inputTicker}`;
  }

  // MAKE: 'Make <recipeLabel>' + optional ' [childScenario]'
  const label = branch.recipeLabel ?? branch.inputTicker;
  const core = `Make ${label}`;
  const suffix = branch.childScenario && branch.childScenario.trim().length
    ? ` [${branch.childScenario}]`
    : "";
  return base + core + suffix;
}

/** Strict equality with tolerant spacing */
export function scenarioEquals(a: string, b: string): boolean {
  return normalizeScenario(a) === normalizeScenario(b);
}

/**
 * Create a display-friendly version of a scenario by stripping nested child scenarios in brackets.
 * Example: "Make C_5 [Make HCP_2 [Buy H2O | Buy NS]] | Make CL [Buy H2O | Buy HAL] | Buy H"
 *       -> "Make C_5 | Make CL | Buy H"
 */
export function scenarioDisplayName(fullScenario: string): string {
  // Remove all bracketed content (including nested brackets)
  let result = fullScenario;
  let changed = true;

  // Keep removing bracketed content until none remain (handles nested brackets)
  while (changed) {
    const before = result;
    result = result.replace(/\s*\[[^\[\]]*\]/g, "");
    changed = before !== result;
  }

  return result.trim();
}

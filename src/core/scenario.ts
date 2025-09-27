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
  const base = prev && prev.length ? prev + ", " : "";

  if (branch.type === "BUY") {
    // "Buy X"
    return base + `Buy ${branch.inputTicker}`;
  }

  // MAKE: 'Make <recipeLabel> (for X)' + optional ' [childScenario]'
  const label = branch.recipeLabel ?? branch.inputTicker;
  const core = `Make ${label} (for ${branch.inputTicker})`;
  const suffix = branch.childScenario && branch.childScenario.trim().length
    ? ` [${branch.childScenario}]`
    : "";
  return base + core + suffix;
}

/** Strict equality with tolerant spacing */
export function scenarioEquals(a: string, b: string): boolean {
  return normalizeScenario(a) === normalizeScenario(b);
}

# Code Review Recommendations

This document provides a summary of the code review and recommendations for improvement.

## 1. Add Unit Tests

The most critical improvement needed is the addition of unit tests. The core business logic, especially in `src/core/engine.ts`, is complex and involves many calculations. Without unit tests, it's difficult to verify the correctness of these calculations and prevent regressions when making changes.

### Recommendation

*   **Introduce a testing framework:** Jest is a popular choice for testing JavaScript and TypeScript applications, and it works well with Next.js.
*   **Start with the core logic:** Begin by writing unit tests for the functions in `src/core`, particularly `engine.ts`, `roi.ts`, and `scenario.ts`.
*   **Test edge cases:** Ensure your tests cover various scenarios, including edge cases and invalid inputs.
*   **Mock dependencies:** Use mocking to isolate the code you're testing from its dependencies, such as data loading.

### Example (using Jest)

A test for `scenarioDisplayName` in `src/core/scenario.ts` could look like this:

```typescript
// src/core/scenario.test.ts
import { scenarioDisplayName } from './scenario';

describe('scenarioDisplayName', () => {
  it('should strip nested child scenarios', () => {
    const fullScenario = 'Make C_5 [Make HCP_2 [Buy H2O | Buy NS]] | Make CL [Buy H2O | Buy HAL] | Buy H';
    const expected = 'Make C_5 | Make CL | Buy H';
    expect(scenarioDisplayName(fullScenario)).toBe(expected);
  });
});
```

## 2. Refactor `src/core/engine.ts`

The `src/core/engine.ts` file is the heart of the application, but it's also the most complex. Refactoring this file will improve maintainability and reduce the risk of bugs.

### Recommendations

*   **Break down long functions:** Functions like `findAllMakeOptions` and `bestOptionForTicker` are very long and do too many things. Break them down into smaller, more focused functions with clear responsibilities. For example, you could have separate functions for collecting inputs, collecting outputs, and building scenarios.
*   **Reduce code duplication:** `findAllMakeOptions` and `bestOptionForTicker` share a lot of similar code. Refactor them to share as much logic as possible. You might be able to combine them into a single function with different options.
*   **Eliminate the use of `any`:** The use of `any` defeats the purpose of TypeScript. Create proper types for objects like `bestMap` and avoid type assertions like `(opt as any)`.

## 3. Improve Error Handling

The current error handling strategy involves returning objects with an `error` property. This can make the code harder to reason about. A better approach is to throw errors and handle them at the API boundary.

### Recommendation

*   **Throw errors:** In functions like `buildReport`, instead of returning `{ ok: false, error: '...' }`, throw an actual error: `throw new Error('...');`.
*   **Use a try-catch block in the API route:** Wrap the call to `buildReport` in the API route (`app/api/report/route.ts`) in a `try-catch` block to handle any errors thrown and return a proper error response.

### Example

```typescript
// src/server/report.ts
if (!tickerPrices) {
  throw new Error(`No price data available for ticker ${ticker}`);
}

// app/api/report/route.ts
export async function GET(req: Request) {
  try {
    // ...
    const report = await buildReport({ ticker, exchange, priceType, priceSource });
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

## 4. Improve Data Access

The code in `src/core/engine.ts` accesses CSV data by column index. This is fragile and can easily break if the structure of the CSV files changes.

### Recommendation

*   **Map CSV rows to objects:** When you load the CSV data in `loadAllFromCsv`, parse the rows into objects with named properties. This will make the code more readable and robust. The `csv-parse` library has options for this.

### Example

Instead of:

```typescript
const recipeId = idx.recipeId !== -1 ? String(row[idx.recipeId] ?? "") : null;
```

You could have:

```typescript
const recipeId = row.RecipeID;
```

## 5. CSS Management

The `app/layout.tsx` file uses inline styles. For a larger application, this can become difficult to manage.

### Recommendation

*   **Use a scalable CSS solution:**
    *   **CSS Modules:** Scope CSS to a specific component.
    *   **Tailwind CSS:** A utility-first CSS framework that can speed up development.
    *   **Styled-components or Emotion:** CSS-in-JS libraries that allow you to write CSS in your JavaScript files.

## 6. `tsconfig.json` Cleanup

The `tsconfig.json` file has some redundant path aliases.

### Recommendation

*   **Remove redundant aliases:** Clean up the `paths` configuration to remove duplicate and unnecessary aliases. This will make the configuration cleaner and easier to understand. For example, you have both `@core/*` and `@/core/*`. You should choose one and use it consistently.

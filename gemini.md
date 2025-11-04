## Project Overview

This is a Next.js web application that appears to be a calculator and data analysis tool for the game "Prosperous Universe". The goal is to help players determine the most profitable production recipes and investment strategies by calculating costs, return on investment (ROI), and payback periods.

## Tech Stack

*   **Framework**: Next.js (with App Router)
*   **Language**: TypeScript
*   **UI**: React
*   **Data Visualization**: Plotly.js
*   **Data Handling**: `csv-parse`, `csv-stringify` for CSV files.

## Project Structure

*   `/app`: Contains the frontend pages and API routes for the Next.js application.
*   `/src`: The main application source code.
    *   `/src/core`: Core business logic for calculations (engine, ROI, scenarios).
    *   `/src/server`: Server-side logic, including data fetching and caching.
    *   `/src/lib`: Utility functions, including CSV fetching and configuration.
*   `/public/data`: Contains the raw data used by the application, primarily in CSV and JSON formats (e.g., material prices, building costs, recipes).
*   `/scripts`: Standalone TypeScript scripts for pre-calculating data, such as generating the "best recipes" and merging price data.

## Core Concepts

*   **Recipes**: Crafting or production formulas from the game.
*   **Prices**: Market prices for materials, fetched and processed.
*   **Costs**: Dynamic calculation of production costs based on recipes and prices.
*   **Scenarios**: User-defined situations or parameters to compare different production strategies.
*   **ROI (Return on Investment)**: A key metric calculated to determine profitability.

## Key Scripts

The `package.json` file contains several important scripts run with `tsx`:

*   `npm run calculate-costs`: Executes `scripts/calculate-dynamic-costs.ts` to pre-calculate costs.
*   `npm run generate-best-recipes`: Executes `scripts/generate-best-recipes.ts` to find the most profitable recipes and saves them to a JSON file.
*   `npm run merge-prices`: Executes `scripts/merge-prices.ts` to merge different price data sources.

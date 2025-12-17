// app/api/aem-data/route.ts
import { NextResponse } from "next/server";
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { GCS_DATA_SOURCES } from "@/lib/config";
import { cachedBestRecipes } from "@/server/cachedBestRecipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Types for the API response
interface RecipeInput {
  ticker: string;
  amount: number;
}

interface RecipeOutput {
  ticker: string;
  amount: number;
}

interface Recipe {
  recipeId: string;
  building: string;
  inputs: RecipeInput[];
  outputs: RecipeOutput[];
}

interface AemDataResponse {
  recipes: Record<string, Recipe[]>; // ticker -> list of recipes that produce it
  tickers: string[];
}

export async function GET(req: Request) {
  try {
    const dataSources = GCS_DATA_SOURCES;

    // Get bestMap from cached best recipes (use ANT bid as default)
    const { bestMap } = await cachedBestRecipes.getBestRecipes("gcs", "ANT", "bid");

    // Load recipes from GCS
    const { recipeMap } = await loadAllFromCsv(
      {
        recipes: dataSources.recipes,
        prices: dataSources.prices,
      },
      { bestMap }
    );

    const headers = recipeMap.headers;

    // Index lookups
    const idx = {
      recipeId: headers.indexOf("RecipeID"),
      building: headers.indexOf("Building"),
    };

    // Find input/output column indices
    const inputIndices: Array<{ mat: number; cnt: number }> = [];
    const outputIndices: Array<{ mat: number; cnt: number }> = [];

    for (let i = 1; i <= 10; i++) {
      const matIdx = headers.indexOf(`Input${i}MAT`);
      const cntIdx = headers.indexOf(`Input${i}CNT`);
      if (matIdx !== -1 && cntIdx !== -1) {
        inputIndices.push({ mat: matIdx, cnt: cntIdx });
      }
    }

    for (let i = 1; i <= 10; i++) {
      const matIdx = headers.indexOf(`Output${i}MAT`);
      const cntIdx = headers.indexOf(`Output${i}CNT`);
      if (matIdx !== -1 && cntIdx !== -1) {
        outputIndices.push({ mat: matIdx, cnt: cntIdx });
      }
    }

    // Build recipe data structure
    const recipes: Record<string, Recipe[]> = {};

    for (const [ticker, rows] of Object.entries(recipeMap.map)) {
      recipes[ticker] = rows.map((row) => {
        const recipeId = idx.recipeId !== -1 ? String(row[idx.recipeId] ?? "") : "";
        const building = idx.building !== -1 ? String(row[idx.building] ?? "") : "";

        const inputs: RecipeInput[] = [];
        for (const { mat, cnt } of inputIndices) {
          const inputTicker = row[mat];
          const inputAmount = Number(row[cnt] ?? 0);
          if (inputTicker && inputAmount > 0) {
            inputs.push({ ticker: String(inputTicker), amount: inputAmount });
          }
        }

        const outputs: RecipeOutput[] = [];
        for (const { mat, cnt } of outputIndices) {
          const outputTicker = row[mat];
          const outputAmount = Number(row[cnt] ?? 0);
          if (outputTicker && outputAmount > 0) {
            outputs.push({ ticker: String(outputTicker), amount: outputAmount });
          }
        }

        return { recipeId, building, inputs, outputs };
      });
    }

    const tickers = Object.keys(recipes).sort();

    const response: AemDataResponse = { recipes, tickers };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error("Failed to load AEM data:", err?.message ?? err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to load recipe data", recipes: {}, tickers: [] },
      { status: 500 }
    );
  }
}

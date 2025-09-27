// app/page.tsx — Server Component using live Google Sheets (Option 2)
import { loadAllFromCsv } from "@/lib/loadFromCsv";
import { findAllMakeOptions, buildScenarioRows } from "@/core/engine";
import type { PriceMode } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = {
  ticker?: string;
  mode?: PriceMode; // "bid" | "ask" | "pp7" | "pp30"
  expand?: string;  // "1" to show child rows
};

export default async function Page({ searchParams }: { searchParams?: SearchParams } = {}) {
  const ticker = (searchParams?.ticker ?? "PCB").toUpperCase();
  const mode = (searchParams?.mode ?? "bid") as PriceMode;
  const showChildren = searchParams?.expand === "1";

  const CSV_URLS = {
    recipes: process.env.CSV_RECIPES_URL!,
    prices:  process.env.CSV_PRICES_URL!,
    best:    process.env.CSV_BEST_URL!,
  };

  if (!CSV_URLS.recipes || !CSV_URLS.prices || !CSV_URLS.best) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Missing CSV_* env vars</h1>
        <p>Please set CSV_RECIPES_URL, CSV_PRICES_URL, CSV_BEST_URL.</p>
      </main>
    );
  }

  try {
    // 1) Load live data from your published CSVs
    const { recipeMap, pricesMap, bestMap } = await loadAllFromCsv(CSV_URLS);

    // 2) Run analysis
    const options = findAllMakeOptions(ticker, recipeMap, pricesMap, mode, bestMap, 0);
    if (!options.length) {
      return (
        <main style={{ padding: 24 }}>
          <h1>No options found</h1>
          <p>Ticker: {ticker}</p>
        </main>
      );
    }

    // 3) Compute Profit/Area at capacity for apples-to-apples comparison
    const withPA = options
      .map((o) => {
        const dailyCapacity = (o.output1Amount || 0) * (o.runsPerDay || 0);
        const r = buildScenarioRows(o, 0, dailyCapacity, showChildren);
        return { ...o, totalProfitPA: r.subtreeProfitPerArea, rows: r.rows };
      })
      .sort((a, b) => (b.totalProfitPA ?? 0) - (a.totalProfitPA ?? 0));

    const best = withPA[0];

    return (
      <main style={{ padding: 24 }}>
        <h1>Report (live Sheets)</h1>
        <p>
          <strong>Ticker:</strong> {ticker} &nbsp; | &nbsp;
          <strong>Mode:</strong> {mode} &nbsp; | &nbsp;
          <strong>Total Options:</strong> {withPA.length} &nbsp; | &nbsp;
          <strong>Best P/A:</strong>{" "}
          {best.totalProfitPA != null ? best.totalProfitPA.toFixed(6) : "n/a"}
        </p>

        <h2>Best Scenario (full object)</h2>
        <pre style={{ whiteSpace: "pre-wrap" }}>
          {JSON.stringify(best, null, 2)}
        </pre>

        <h2>Top 5 (summary only)</h2>
        <pre style={{ whiteSpace: "pre-wrap" }}>
          {JSON.stringify(
            withPA.slice(0, 5).map(({ rows, ...rest }) => rest),
            null,
            2
          )}
        </pre>

        <p style={{ marginTop: 16, color: "#666" }}>
          Tip: use <code>?ticker=XYZ&amp;mode=pp7</code> or add{" "}
          <code>&amp;expand=1</code> to include child rows in the best option.
        </p>
      </main>
    );
  } catch (err: any) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Error</h1>
        <pre style={{ whiteSpace: "pre-wrap" }}>
          {String(err?.message ?? err)}
        </pre>
      </main>
    );
  }
}

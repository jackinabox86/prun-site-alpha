// app/page.tsx — Server Component that calls the shared report builder directly
import { buildReport } from "@/server/report";
import type { PriceMode } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SP = Record<string, string | string[] | undefined>;

export default async function Page(props: { searchParams?: SP }) {
  const sp = props?.searchParams ?? {};

  const getStr = (k: string, fallback: string) => {
    const v = Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k];
    return (v as string | undefined) ?? fallback;
  };

  const ticker = getStr("ticker", "PCB").toUpperCase();
  const priceMode = (getStr("mode", getStr("priceMode", "bid")) as PriceMode);
  const expand = getStr("expand", "") === "1";

  const data = await buildReport({ ticker, priceMode, expand });

  if ((data as any)?.ok === false) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Report (live Sheets)</h1>
        <p>
          <strong>Ticker:</strong> {ticker} &nbsp; | &nbsp;
          <strong>Mode:</strong> {priceMode}
        </p>
        <h2 style={{ color: "#b00" }}>API Error</h2>
        <pre style={{ whiteSpace: "pre-wrap" }}>
          {JSON.stringify(data, null, 2)}
        </pre>
        <p style={{ marginTop: 16, color: "#666" }}>
          Tip: open <code>/api/report?ticker={ticker}&amp;priceMode={priceMode}</code> to inspect the JSON output shape.
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Report (live Sheets)</h1>
      <p>
        <strong>Ticker:</strong> {data.ticker} &nbsp; | &nbsp;
        <strong>Mode:</strong> {data.priceMode} &nbsp; | &nbsp;
        <strong>Total Options:</strong> {data.totalOptions} &nbsp; | &nbsp;
        <strong>Best P/A:</strong>{" "}
        {data.bestPA != null ? Number(data.bestPA).toFixed(6) : "n/a"}
      </p>

      <h2>Best Scenario (full object)</h2>
      <pre style={{ whiteSpace: "pre-wrap" }}>
        {JSON.stringify(data.best, null, 2)}
      </pre>

      <h2>Top 5 (summary only)</h2>
      <pre style={{ whiteSpace: "pre-wrap" }}>
        {JSON.stringify(data.top5, null, 2)}
      </pre>

      <p style={{ marginTop: 16, color: "#666" }}>
        Tip: try <code>?ticker=XYZ&amp;mode=pp7</code> or add{" "}
        <code>&amp;expand=1</code> to include child rows in the best option.
      </p>
    </main>
  );
}

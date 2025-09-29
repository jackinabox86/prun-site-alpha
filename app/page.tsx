// app/page.tsx — Server Component calling shared report builder directly
import { buildReport } from "@/server/report";
import type { PriceMode } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SP = Record<string, string | string[] | undefined>;

export default async function Page({
  searchParams,
}: {
  // IMPORTANT: Next expects this to be a Promise
  searchParams?: Promise<SP>;
}) {
  // Works whether Next gives us a Promise or a plain object
  const sp = (await searchParams) ?? ({} as SP);

  const getStr = (k: string, fallback: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? fallback;
  };

  const ticker = getStr("ticker", "PCB").toUpperCase();
  const priceMode = (getStr("mode", getStr("priceMode", "bid")) as PriceMode);
  const expand = getStr("expand", "") === "1";
  const includeRows = getStr("rows", "") === "1"; // rows off by default

  const data = await buildReport({ ticker, priceMode, expand, includeRows });

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
          Tip: open <code>/api/report?ticker={ticker}&amp;priceMode={priceMode}</code> to inspect the JSON output.
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

      <h2>Best Scenario (raw)</h2>
      <pre style={{ whiteSpace: "pre-wrap" }}>
        {JSON.stringify(data.best, null, 2)}
      </pre>

      <h2>Top 5 (summary only)</h2>
      <pre style={{ whiteSpace: "pre-wrap" }}>
        {JSON.stringify(data.top5, null, 2)}
      </pre>

      <p style={{ marginTop: 16, color: "#666" }}>
        Tip: try <code>?ticker=XYZ&amp;mode=pp7</code>. For a human-readable tree,
        add <code>&amp;rows=1</code> (and optionally <code>&amp;expand=1</code>).
      </p>
    </main>
  );
}

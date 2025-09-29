// app/page.tsx — Server Component that delegates to /api/report
import { headers } from "next/headers";
import type { PriceMode } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page(props: any) {
  // Normalize searchParams: support object OR Promise (Next can pass either)
  const raw = props?.searchParams;
  const sp: Record<string, string | string[] | undefined> =
    raw && typeof raw.then === "function" ? await raw : (raw ?? {});

  const getStr = (k: string, fallback: string) => {
    const v = Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k];
    return (v as string | undefined) ?? fallback;
  };

  const ticker = getStr("ticker", "PCB").toUpperCase();
  // accept both ?mode= and legacy ?priceMode=
  const priceMode = (getStr("mode", getStr("priceMode", "bid")) as PriceMode);
  const expand = getStr("expand", "") === "1";

  // Build absolute URL for the API route (works locally, Vercel, Codespaces)
  const h = await headers(); // <-- await fixes TS error
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const baseUrl = `${proto}://${host}`;

  const qs = new URLSearchParams({
    ticker,
    priceMode,
    ...(expand ? { expand: "1" } : {}),
  });

  const res = await fetch(`${baseUrl}/api/report?${qs.toString()}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Error</h1>
        <p>Failed to fetch /api/report</p>
        <pre>{`${res.status} ${res.statusText}`}</pre>
      </main>
    );
  }

  const data = await res.json();

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

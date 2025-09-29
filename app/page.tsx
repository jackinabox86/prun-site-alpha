// app/page.tsx — Server Component that delegates to /api/report
import type { PriceMode } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page(props: any) {
  // Normalize searchParams: support object OR Promise
  const raw = props?.searchParams;
  const sp: Record<string, string | string[] | undefined> =
    raw && typeof raw.then === "function" ? await raw : (raw ?? {});

  const getStr = (k: string, fallback: string) => {
    const v = Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k];
    return (v as string | undefined) ?? fallback;
  };

  const ticker = getStr("ticker", "PCB").toUpperCase();
  const priceMode = (getStr("mode", getStr("priceMode", "bid")) as PriceMode);
  const expand = getStr("expand", "") === "1";

  const qs = new URLSearchParams({
    ticker,
    priceMode,
    ...(expand ? { expand: "1" } : {}),
  });

  let data: any = null;
  let fetchError: string | null = null;

  
  // NOTE: We call the API relatively to avoid 401s in Codespaces/preview proxies.
// If the API moves to a different origin, switch to an absolute URL and forward cookies:
//
// import { headers } from "next/headers";
// const h = headers();
// const base = process.env.NEXT_PUBLIC_BASE_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
// const res = await fetch(`${base}/api/report?${qs}`, {
//   cache: "no-store",
//   headers: { cookie: h.get("cookie") ?? "" } // forward session/auth
// });
  
  try {
    // Relative fetch keeps cookies/session and works on Vercel/Codespaces/local
    const res = await fetch(`/api/report?${qs.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      // Still try to read JSON to show a specific error message when available
      let body: any = null;
      try { body = await res.json(); } catch {}
      fetchError = body?.error || `${res.status} ${res.statusText}`;
    } else {
      data = await res.json();
    }
  } catch (err: any) {
    fetchError = String(err?.message ?? err);
  }

  if (fetchError) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Report (live Sheets)</h1>
        <p>
          <strong>Ticker:</strong> {ticker} &nbsp; | &nbsp;
          <strong>Mode:</strong> {priceMode}
        </p>
        <h2>API Error</h2>
        <pre style={{ whiteSpace: "pre-wrap" }}>{fetchError}</pre>
        <p style={{ marginTop: 16, color: "#666" }}>
          Tip: open <code>/api/report?{qs.toString()}</code> directly to inspect the raw JSON.
        </p>
      </main>
    );
  }

  // Happy path
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

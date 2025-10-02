import { parse } from "csv-parse/sync";

// In-memory cache for serverless functions (persists across invocations in same container)
const csvCache = new Map<string, Array<Record<string, any>>>();

export async function fetchCsv(url: string): Promise<Array<Record<string, any>>> {
  if (!url) {
    throw new Error("CSV URL is empty. Please set BLOB_*_URL environment variables.");
  }

  // Check cache first
  if (csvCache.has(url)) {
    return csvCache.get(url)!;
  }

  // Fetch from Vercel Blob (or any URL)
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`CSV fetch failed: ${res.status} ${res.statusText} for URL: ${url}`);
  }

  const text = await res.text();
  const rows: string[][] = parse(text, { skip_empty_lines: true });
  if (!rows.length) return [];

  const [headers, ...data] = rows;
  const result = data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));

  // Cache the result
  csvCache.set(url, result);

  return result;
}

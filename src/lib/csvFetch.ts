import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { join } from "path";

// In-memory cache for serverless functions (persists across invocations in same container)
const csvCache = new Map<string, Array<Record<string, any>>>();

export async function fetchCsv(pathOrUrl: string): Promise<Array<Record<string, any>>> {
  // Check cache first
  if (csvCache.has(pathOrUrl)) {
    return csvCache.get(pathOrUrl)!;
  }

  let text: string;

  // If it's a URL, fetch it
  if (pathOrUrl.startsWith("http")) {
    const res = await fetch(pathOrUrl, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`CSV fetch failed ${res.status}`);
    text = await res.text();
  } else {
    // Local path - try filesystem first, then fall back to HTTP
    const localPath = join(process.cwd(), pathOrUrl);

    try {
      // Try reading from filesystem (works in local dev)
      text = readFileSync(localPath, "utf-8");
    } catch (err) {
      // If file not found on filesystem, try fetching via HTTP from /public
      // In Vercel, public folder is served at root URL
      const publicPath = pathOrUrl.replace(/^public\//, "/");
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

      const url = `${baseUrl}${publicPath}`;
      const res = await fetch(url, { cache: "no-store" });

      if (!res.ok) {
        throw new Error(`Could not find CSV file at ${localPath} or ${url}`);
      }

      text = await res.text();
    }
  }

  const rows: string[][] = parse(text, { skip_empty_lines: true });
  if (!rows.length) return [];
  const [headers, ...data] = rows;
  const result = data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));

  // Cache the result
  csvCache.set(pathOrUrl, result);

  return result;
}

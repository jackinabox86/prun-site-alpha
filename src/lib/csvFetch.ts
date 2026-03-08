import { parse } from "csv-parse/sync";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// In-memory cache for serverless functions (persists across invocations in same container)
const csvCache = new Map<string, Array<Record<string, any>>>();

async function fetchWithRetry(url: string, maxAttempts = 4): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`CSV fetch failed: ${res.status} ${res.statusText} for URL: ${url}`);
      }
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delayMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        console.warn(`[csvFetch] Attempt ${attempt} failed for ${url}: ${(err as Error).message}. Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

export async function fetchCsv(url: string): Promise<Array<Record<string, any>>> {
  if (!url) {
    throw new Error("CSV URL is empty. Please set GCS_*_URL environment variables.");
  }

  // Check cache first
  if (csvCache.has(url)) {
    return csvCache.get(url)!;
  }

  let text: string;

  // Check if it's a local file path (doesn't start with http)
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const filePath = join(process.cwd(), url);
    if (!existsSync(filePath)) {
      throw new Error(`Local CSV file not found: ${filePath}`);
    }
    text = readFileSync(filePath, 'utf-8');
  } else {
    // Fetch from remote URL (GCS or other) with retry on transient socket errors
    text = await fetchWithRetry(url);
  }
  const rows: string[][] = parse(text, { skip_empty_lines: true });
  if (!rows.length) return [];

  const [headers, ...data] = rows;
  const result = data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));

  // Cache the result
  csvCache.set(url, result);

  return result;
}

import { parse } from "csv-parse/sync";

export async function fetchCsv(url: string): Promise<Array<Record<string, any>>> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });
    if (!res.ok) throw new Error(`CSV fetch failed: ${res.status} ${res.statusText} for URL: ${url}`);
    const text = await res.text();
    const rows: string[][] = parse(text, { skip_empty_lines: true });
    if (!rows.length) return [];
    const [headers, ...data] = rows;
    return data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
  } catch (error) {
    console.error(`Failed to fetch CSV from ${url}:`, error);
    throw new Error(`CSV fetch failed for ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

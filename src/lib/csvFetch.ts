import { parse } from "csv-parse/sync";

export async function fetchCsv(url: string): Promise<Array<Record<string, any>>> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
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

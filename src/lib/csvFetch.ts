import { parse } from "csv-parse/sync";

export async function fetchCsv(url: string): Promise<Array<Record<string, any>>> {
  const res = await fetch(url, { cache: "no-store" }); // or { next: { revalidate: 300 } }
  if (!res.ok) throw new Error(`CSV fetch failed ${res.status}`);
  const text = await res.text();
  const rows: string[][] = parse(text, { skip_empty_lines: true });
  if (!rows.length) return [];
  const [headers, ...data] = rows;
  return data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { join } from "path";

export async function fetchCsv(pathOrUrl: string): Promise<Array<Record<string, any>>> {
  let text: string;

  // If it's a local path, read from filesystem
  if (!pathOrUrl.startsWith("http")) {
    const fullPath = join(process.cwd(), pathOrUrl);
    text = readFileSync(fullPath, "utf-8");
  } else {
    // Otherwise fetch from URL
    const res = await fetch(pathOrUrl, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`CSV fetch failed ${res.status}`);
    text = await res.text();
  }

  const rows: string[][] = parse(text, { skip_empty_lines: true });
  if (!rows.length) return [];
  const [headers, ...data] = rows;
  return data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

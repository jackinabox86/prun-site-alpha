import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { join } from "path";

export async function fetchCsv(pathOrUrl: string): Promise<Array<Record<string, any>>> {
  let text: string | undefined;

  // If it's a local path, read from filesystem
  if (!pathOrUrl.startsWith("http")) {
    // Try multiple possible locations for the file
    const possiblePaths = [
      join(process.cwd(), pathOrUrl),           // Local dev: /workspaces/project/data/file.csv
      join(__dirname, "..", "..", pathOrUrl),   // Vercel: relative to this file
      join("/var/task", pathOrUrl),             // Vercel: absolute from task root
    ];

    for (const path of possiblePaths) {
      try {
        text = readFileSync(path, "utf-8");
        break;
      } catch (err) {
        // Try next path
        continue;
      }
    }

    if (!text) {
      throw new Error(`Could not find CSV file at any of these locations: ${possiblePaths.join(", ")}`);
    }
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

// app/api/snapshot/route.ts
import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Folders to scan (adjust if you want more/less)
const BASE_DIRS = ["app", "src", "docs"];

// Ignore these directories
const IGNORE_DIRS = new Set([
  "node_modules", ".next", ".git", ".vercel", ".turbo", "coverage", "dist", "out", ".DS_Store"
]);

// Only include text-y files
const ALLOWED_EXTS = new Set([
  ".ts", ".tsx", ".js", ".json", ".md", ".yml", ".yaml", ".css", ".scss", ".mjs", ".cjs"
]);

// Safety caps (bump if you truly want *everything*)
const MAX_LIST = 10000; // max files to include

function sha256(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}

async function walk(dir: string, root: string, out: string[] = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_LIST) break;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      await walk(full, root, out);
    } else if (e.isFile()) {
      const lower = e.name.toLowerCase();
      const dot = lower.lastIndexOf(".");
      const ext = dot >= 0 ? lower.slice(dot) : "";
      if (ALLOWED_EXTS.has(ext)) out.push(full.replace(root + sep, ""));
    }
  }
  return out;
}

export async function GET() {
  const root = process.cwd();

  try {
    // 1) Gather all candidate files
    const relFiles: string[] = [];
    for (const base of BASE_DIRS) {
      const start = resolve(root, base);
      await walk(start, root, relFiles);
      if (relFiles.length >= MAX_LIST) break;
    }

    // 2) Read each file, compute hash/size, include full content
    const files = [];
    for (const rel of relFiles) {
      try {
        const abs = resolve(root, rel);
        const [buf, st] = await Promise.all([readFile(abs), stat(abs)]);
        files.push({
          path: rel,
          size: st.size,
          hash: sha256(buf),
          lines: buf.toString("utf8").split("\n").length,
          content: buf.toString("utf8"),
        });
      } catch (e: any) {
        files.push({ path: rel, error: e?.message ?? String(e) });
      }
    }

    return NextResponse.json({
      ok: true,
      total: files.length,
      note: "Full content included for all matched files.",
      files
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}

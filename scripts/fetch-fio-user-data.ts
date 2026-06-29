/**
 * Fetch FIO user data (company name + account creation date) for all users.
 *
 * Calls /user/allusers to get the username list, then fetches each user at
 * 2 req/s. Writes a CSV to public/data/fio-user-data.csv for upload to GCS.
 *
 * Usage:
 *   FIO_API_KEY=<key> tsx scripts/fetch-fio-user-data.ts
 *   FIO_API_KEY=<key> tsx scripts/fetch-fio-user-data.ts --dry-run
 */

import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import path from "path";

const FNAR_BASE = "https://rest.fnar.net";
const OUTPUT_PATH = path.join("public", "data", "fio-user-data.csv");
const GCS_PATH = "gs://prun-site-alpha-bucket/fio-user-data.csv";
const RATE_LIMIT_MS = 500; // 2 req/s

const dryRun = process.argv.includes("--dry-run");
const apiKey = process.env.FIO_API_KEY ?? "";

if (!apiKey) {
  console.error("Error: FIO_API_KEY environment variable is required.");
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface FnarUserDetail {
  UserName?: string;
  CompanyName?: string;
  // Creation date — the API may use any of these field names
  Created?: string | number;
  CreatedEpochMs?: number;
  StartDate?: string | number;
  RegistrationDate?: string | number;
  [key: string]: unknown;
}

function parseCreatedEpochMs(u: FnarUserDetail): number | null {
  for (const v of [u.CreatedEpochMs, u.Created, u.StartDate, u.RegistrationDate]) {
    if (v == null) continue;
    if (typeof v === "number" && v > 0) return v < 1e12 ? v * 1000 : v;
    if (typeof v === "string") {
      const d = Date.parse(v);
      if (!isNaN(d)) return d;
    }
  }
  return null;
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function main() {
  console.log(`Mode: ${dryRun ? "DRY RUN" : "PRODUCTION"}`);
  console.log("Fetching username list from /user/allusers…");

  const listRes = await fetch(`${FNAR_BASE}/user/allusers`, {
    headers: { Authorization: apiKey, accept: "application/json" },
  });

  if (!listRes.ok) {
    console.error(`Failed to fetch allusers: HTTP ${listRes.status}`);
    process.exit(1);
  }

  const allUsers: string[] = await listRes.json();
  console.log(`Got ${allUsers.length} usernames. Fetching details at 2 req/s…`);

  const rows: string[] = ["username,company_name,created_epoch_ms"];
  let success = 0;
  let missing = 0;
  let failed = 0;

  for (let i = 0; i < allUsers.length; i++) {
    const username = allUsers[i];

    if (i > 0) await sleep(RATE_LIMIT_MS);

    if (i % 100 === 0) {
      console.log(`  ${i}/${allUsers.length} (${success} ok, ${missing} missing, ${failed} errors)`);
    }

    try {
      const res = await fetch(`${FNAR_BASE}/user/${encodeURIComponent(username)}`, {
        headers: { Authorization: apiKey, accept: "application/json" },
      });

      if (res.status === 204 || res.status === 404) {
        missing++;
        continue;
      }

      if (!res.ok) {
        console.warn(`  WARN: ${username} → HTTP ${res.status}`);
        failed++;
        continue;
      }

      const detail: FnarUserDetail = await res.json();
      const companyName = detail.CompanyName ?? username;
      const createdMs = parseCreatedEpochMs(detail);

      rows.push(
        [
          escapeCsv(username),
          escapeCsv(companyName),
          createdMs !== null ? String(createdMs) : "",
        ].join(",")
      );
      success++;
    } catch (err) {
      console.warn(`  ERROR: ${username} → ${err}`);
      failed++;
    }
  }

  console.log(`\nDone: ${success} ok, ${missing} missing, ${failed} errors`);
  console.log(`Total rows: ${rows.length - 1}`);

  const csv = rows.join("\n") + "\n";

  if (dryRun) {
    console.log("\nDry run — skipping file write and GCS upload.");
    console.log("Sample output (first 5 data rows):");
    console.log(rows.slice(0, 6).join("\n"));
    return;
  }

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, csv, "utf8");
  console.log(`\nWrote ${OUTPUT_PATH}`);

  console.log(`Uploading to ${GCS_PATH}…`);
  execSync(
    `gsutil -h "Cache-Control:public, max-age=3600" -h "Content-Type:text/csv" cp ${OUTPUT_PATH} ${GCS_PATH}`,
    { stdio: "inherit" }
  );
  console.log("Upload complete.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

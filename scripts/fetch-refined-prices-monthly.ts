import { execSync } from "child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Fetch all.json from refined-prun/refined-prices for the first commit of each
 * of the last 18 months and upload to GCS at monthly-refined-prices/.
 *
 * Usage:
 *   npm run fetch-refined-prices-monthly
 */

const REPO = "refined-prun/refined-prices";
const GCS_BUCKET = "prun-site-alpha-bucket";
const GCS_FOLDER = "monthly-refined-prices";
const MONTHS_BACK = 18;
const GITHUB_API = "https://api.github.com/repos";

const MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function getMonthDates(count: number): { label: string; since: string; until: string }[] {
  const dates: { label: string; since: string; until: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const label = `${yyyy}-${mm}-01`;
    dates.push({
      label,
      since: `${label}T00:00:00Z`,
      until: `${label}T12:00:00Z`,
    });
  }
  return dates;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

async function run() {
  const monthDates = getMonthDates(MONTHS_BACK);
  const tmp = tmpdir();

  console.log(`\nFetching ${MONTHS_BACK} months of all.json from ${REPO}`);
  console.log(`Uploading to gs://${GCS_BUCKET}/${GCS_FOLDER}/\n`);

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (const { label, since, until } of monthDates) {
    process.stdout.write(`${label}  `);

    let sha: string | undefined;
    try {
      const commitsUrl =
        `${GITHUB_API}/${REPO}/commits?path=all.json&since=${since}&until=${until}&per_page=100`;
      const commits = (await fetchJson(commitsUrl)) as Array<{ sha: string }>;

      if (!Array.isArray(commits) || commits.length === 0) {
        console.log("no commit found, skipping");
        skipCount++;
        continue;
      }

      // API returns newest-first; last entry = earliest commit of the day
      sha = commits[commits.length - 1].sha;
    } catch (err) {
      console.log(`API error: ${err}`);
      failCount++;
      continue;
    }

    let content: string;
    try {
      const rawUrl = `https://raw.githubusercontent.com/${REPO}/${sha}/all.json`;
      content = await fetchText(rawUrl);
    } catch (err) {
      console.log(`download error: ${err}`);
      failCount++;
      continue;
    }

    const tmpFile = join(tmp, `all-${label}.json`);
    const gcsPath = `gs://${GCS_BUCKET}/${GCS_FOLDER}/all-${label}.json`;

    try {
      writeFileSync(tmpFile, content, "utf8");
      execSync(`gsutil cp "${tmpFile}" "${gcsPath}"`, {
        encoding: "utf8",
        stdio: "pipe",
      });
      unlinkSync(tmpFile);
      console.log(`uploaded  (sha: ${sha.slice(0, 8)})`);
      successCount++;
    } catch (err) {
      console.log(`upload error: ${err}`);
      failCount++;
    }

    // Stay within GitHub's 60 req/hr unauthenticated rate limit
    await new Promise((r) => setTimeout(r, 1200));
  }

  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log(`Uploaded: ${successCount}`);
  console.log(`Skipped:  ${skipCount}`);
  console.log(`Failed:   ${failCount}`);
  console.log(`\nGCS location: gs://${GCS_BUCKET}/${GCS_FOLDER}/`);
  console.log();

  if (failCount > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

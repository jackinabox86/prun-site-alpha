import { execSync } from "child_process";

// Test branch detection logic
function getCurrentBranch(): string {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
    }).trim();
    return branch;
  } catch (error) {
    console.warn("⚠️  Could not detect git branch, defaulting to 'unknown'");
    return "unknown";
  }
}

function isProductionBranch(branch: string): boolean {
  return branch === "main";
}

const CURRENT_BRANCH = getCurrentBranch();
const IS_PRODUCTION = isProductionBranch(CURRENT_BRANCH);

console.log("\n🧪 Branch Detection Test\n");
console.log(`   Current branch: ${CURRENT_BRANCH}`);
console.log(`   Is production: ${IS_PRODUCTION}`);
console.log(`   Mode: ${IS_PRODUCTION ? "🟢 PRODUCTION" : "🟡 TEST"}`);

const GCS_BUCKET = "prun-site-alpha-bucket";
const LOCAL_DIR = IS_PRODUCTION
  ? "public/data/historical-prices"
  : "public/data/historical-prices-test";
const GCS_PATH = IS_PRODUCTION
  ? "historical-prices"
  : `historical-prices-test/${CURRENT_BRANCH}`;

console.log(`\n   Paths:`);
console.log(`   Local: ${LOCAL_DIR}`);
console.log(`   GCS: gs://${GCS_BUCKET}/${GCS_PATH}`);
console.log();

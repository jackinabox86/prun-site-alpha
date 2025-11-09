import { execSync } from "child_process";
import { readFileSync } from "fs";

// Test branch detection logic with multiple fallback methods
function getCurrentBranch(): string {
  try {
    // Method 1: git rev-parse (most reliable)
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (branch && branch !== "HEAD") {
      console.log("✅ Method 1 (git rev-parse) succeeded");
      return branch;
    }
  } catch (error) {
    console.log("❌ Method 1 (git rev-parse) failed");
  }

  try {
    // Method 2: git symbolic-ref (works in detached HEAD)
    const branch = execSync("git symbolic-ref --short HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (branch) {
      console.log("✅ Method 2 (git symbolic-ref) succeeded");
      return branch;
    }
  } catch (error) {
    console.log("❌ Method 2 (git symbolic-ref) failed");
  }

  try {
    // Method 3: git branch --show-current (modern git)
    const branch = execSync("git branch --show-current", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (branch) {
      console.log("✅ Method 3 (git branch --show-current) succeeded");
      return branch;
    }
  } catch (error) {
    console.log("❌ Method 3 (git branch --show-current) failed");
  }

  try {
    // Method 4: Check GITHUB_REF environment variable (GitHub Actions/Codespaces)
    if (process.env.GITHUB_REF) {
      const match = process.env.GITHUB_REF.match(/refs\/heads\/(.+)/);
      if (match && match[1]) {
        console.log("✅ Method 4 (GITHUB_REF env var) succeeded");
        return match[1];
      }
    }
    console.log("❌ Method 4 (GITHUB_REF env var) - not set or invalid");
  } catch (error) {
    console.log("❌ Method 4 (GITHUB_REF env var) failed");
  }

  try {
    // Method 5: Check CODESPACE_VSCODE_FOLDER (GitHub Codespaces specific)
    if (process.env.CODESPACE_VSCODE_FOLDER) {
      // Try to read .git/HEAD directly
      const gitHead = readFileSync(".git/HEAD", "utf8").trim();
      const match = gitHead.match(/ref: refs\/heads\/(.+)/);
      if (match && match[1]) {
        console.log("✅ Method 5 (.git/HEAD file) succeeded");
        return match[1];
      }
    }
    console.log("❌ Method 5 (.git/HEAD file) - not in Codespaces or failed");
  } catch (error) {
    console.log("❌ Method 5 (.git/HEAD file) failed");
  }

  // All methods failed
  console.log("⚠️  All methods failed");
  return "unknown";
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

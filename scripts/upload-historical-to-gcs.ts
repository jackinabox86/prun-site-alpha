import { execSync } from "child_process";

/**
 * Upload historical price data to Google Cloud Storage
 *
 * Branch-aware behavior:
 * - main branch: uploads to gs://prun-site-alpha-bucket/historical-prices/
 * - other branches: uploads to gs://prun-site-alpha-bucket/historical-prices-test/{branch}/
 *
 * This ensures test data doesn't overwrite production data.
 *
 * Prerequisites:
 * - gcloud CLI installed and authenticated
 * - GCP_SA_KEY secret configured (for GitHub Actions)
 *
 * Usage:
 *   npm run upload-historical
 */

// Detect current git branch with multiple fallback methods
function getCurrentBranch(): string {
  try {
    // Method 1: git rev-parse (most reliable)
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (branch && branch !== "HEAD") {
      return branch;
    }
  } catch (error) {
    // Silently continue to next method
  }

  try {
    // Method 2: git symbolic-ref (works in detached HEAD)
    const branch = execSync("git symbolic-ref --short HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (branch) {
      return branch;
    }
  } catch (error) {
    // Silently continue to next method
  }

  try {
    // Method 3: git branch --show-current (modern git)
    const branch = execSync("git branch --show-current", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (branch) {
      return branch;
    }
  } catch (error) {
    // Silently continue to next method
  }

  try {
    // Method 4: Check GITHUB_REF environment variable (GitHub Actions/Codespaces)
    if (process.env.GITHUB_REF) {
      const match = process.env.GITHUB_REF.match(/refs\/heads\/(.+)/);
      if (match && match[1]) {
        console.log(`   ℹ️  Detected branch from GITHUB_REF: ${match[1]}`);
        return match[1];
      }
    }
  } catch (error) {
    // Silently continue
  }

  try {
    // Method 5: Check CODESPACE_VSCODE_FOLDER (GitHub Codespaces specific)
    if (process.env.CODESPACE_VSCODE_FOLDER) {
      // Try to read .git/HEAD directly
      const fs = require("fs");
      const gitHead = fs.readFileSync(".git/HEAD", "utf8").trim();
      const match = gitHead.match(/ref: refs\/heads\/(.+)/);
      if (match && match[1]) {
        console.log(`   ℹ️  Detected branch from .git/HEAD: ${match[1]}`);
        return match[1];
      }
    }
  } catch (error) {
    // Silently continue
  }

  // All methods failed
  console.warn("⚠️  Could not detect git branch, defaulting to 'unknown'");
  console.warn("   This is safe - data will go to test folder, not production");
  return "unknown";
}

// Determine if running in production mode
function isProductionBranch(branch: string): boolean {
  return branch === "main";
}

const CURRENT_BRANCH = getCurrentBranch();
const IS_PRODUCTION = isProductionBranch(CURRENT_BRANCH);

const GCS_BUCKET = "prun-site-alpha-bucket";
const LOCAL_DIR = IS_PRODUCTION
  ? "public/data/historical-prices"
  : "public/data/historical-prices-test";
const GCS_PATH = IS_PRODUCTION
  ? "historical-prices"
  : `historical-prices-test/${CURRENT_BRANCH}`;

async function uploadToGCS() {
  console.log("\n📤 Uploading historical price data to Google Cloud Storage\n");
  console.log(`   Branch: ${CURRENT_BRANCH}`);
  console.log(`   Mode: ${IS_PRODUCTION ? "🟢 PRODUCTION" : "🟡 TEST"}`);
  console.log(`   Local directory: ${LOCAL_DIR}`);
  console.log(`   GCS destination: gs://${GCS_BUCKET}/${GCS_PATH}/\n`);

  // Confirm if production
  if (IS_PRODUCTION) {
    console.log("⚠️  WARNING: You are uploading to PRODUCTION!");
    console.log("   This will overwrite production historical price data.");
    console.log("   Press Ctrl+C to cancel, or wait 5 seconds to continue...\n");

    // 5 second delay for production uploads
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  try {
    // Check if gsutil is available
    try {
      execSync("gsutil --version", { stdio: "ignore" });
    } catch (error) {
      console.error("❌ gsutil not found. Please install Google Cloud SDK:");
      console.error("   https://cloud.google.com/sdk/docs/install\n");
      process.exit(1);
    }

    // Upload files
    console.log("🔄 Uploading files...\n");

    const uploadCommand = `gsutil -m -h "Cache-Control:public, max-age=3600" cp -r ${LOCAL_DIR}/* gs://${GCS_BUCKET}/${GCS_PATH}/`;

    console.log(`   Running: ${uploadCommand}\n`);

    execSync(uploadCommand, { stdio: "inherit" });

    console.log("\n✅ Upload complete!");
    console.log(`   Files uploaded to: gs://${GCS_BUCKET}/${GCS_PATH}/`);

    if (!IS_PRODUCTION) {
      console.log(`\n⚠️  TEST MODE: Data uploaded to test folder`);
      console.log(`   Production data was NOT modified`);
    }

    console.log();
  } catch (error: any) {
    console.error("\n❌ Upload failed:", error.message);
    process.exit(1);
  }
}

uploadToGCS().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

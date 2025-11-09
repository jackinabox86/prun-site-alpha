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

// Detect current git branch
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

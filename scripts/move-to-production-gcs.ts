import { execSync } from "child_process";

/**
 * Move historical price files from test to production folder in GCS
 *
 * This performs a GCS-to-GCS copy/move without downloading files locally.
 *
 * Usage:
 *   npm run move-to-production-gcs
 */

// Detect current git branch
function getCurrentBranch(): string {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (branch && branch !== "HEAD") {
      return branch;
    }
  } catch (error) {
    // Fallback
  }
  return "unknown";
}

async function moveToProduction() {
  const CURRENT_BRANCH = getCurrentBranch();
  const gcsBucket = "prun-site-alpha-bucket";

  const sourcePrefix = `historical-prices-test/${CURRENT_BRANCH}`;
  const destPrefix = `historical-prices`;

  const sourcePath = `gs://${gcsBucket}/${sourcePrefix}/`;
  const destPath = `gs://${gcsBucket}/${destPrefix}/`;

  console.log("\n📦 Moving Historical Price Files to Production");
  console.log(`   Source: ${sourcePath}`);
  console.log(`   Destination: ${destPath}`);
  console.log();

  // First, check if source exists and count files
  console.log("🔍 Checking source location...\n");
  try {
    const listOutput = execSync(`gsutil ls "${sourcePath}*.json" | wc -l`, {
      encoding: "utf8",
    }).trim();
    const fileCount = parseInt(listOutput);
    console.log(`✅ Found ${fileCount} files in source location\n`);

    if (fileCount === 0) {
      console.log("❌ No files found to move. Exiting.");
      return;
    }
  } catch (error) {
    console.error("❌ Error checking source location:", error);
    console.log("\nMake sure the source path exists and contains files.");
    process.exit(1);
  }

  // Confirm with user before proceeding
  console.log("⚠️  This will copy all files to the production folder.");
  console.log("   Files will be copied (not moved), so originals remain in test folder.\n");

  console.log("🚀 Starting copy operation...\n");

  try {
    // Use gsutil -m (multi-threaded) for faster copying
    execSync(`gsutil -m cp -r "${sourcePath}*.json" "${destPath}"`, {
      encoding: "utf8",
      stdio: "inherit",
    });

    console.log("\n" + "=".repeat(60));
    console.log("✅ Copy Complete!");
    console.log("=".repeat(60));
    console.log(`\n📁 Files are now available at: ${destPath}`);
    console.log(`📁 Original files remain at: ${sourcePath}`);
    console.log();
    console.log("💡 If you want to delete the test files after verification:");
    console.log(`   gsutil -m rm "${sourcePath}*.json"`);
    console.log();
  } catch (error) {
    console.error("\n❌ Copy operation failed:", error);
    process.exit(1);
  }
}

moveToProduction().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

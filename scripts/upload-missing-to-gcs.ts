import { execSync } from "child_process";

/**
 * Upload only the recently fetched missing files to GCS
 *
 * This script uploads specific files that were just fetched
 * to avoid re-uploading the entire dataset.
 *
 * Usage:
 *   npm run upload-missing-gcs
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

function isProductionBranch(branch: string): boolean {
  return branch === "main";
}

async function uploadMissingFiles() {
  const CURRENT_BRANCH = getCurrentBranch();
  const IS_PRODUCTION = isProductionBranch(CURRENT_BRANCH);

  const localDir = IS_PRODUCTION
    ? "public/data/historical-prices"
    : `public/data/historical-prices-test`;

  const gcsBucket = "prun-site-alpha-bucket";
  const gcsPath = IS_PRODUCTION
    ? "historical-prices"
    : `historical-prices-test/${CURRENT_BRANCH}`;

  // The 7 files that were just fetched
  const filesToUpload = [
    "GWS-ic1.json",
    "LCR-ic1.json",
    "CAP-ai1.json",
    "RAD-ic1.json",
    "MHP-ic1.json",
    "TSH-ai1.json",
    "BRS-ic1.json",
  ];

  console.log("\n📤 Uploading Missing Files to GCS");
  console.log(`   Branch: ${CURRENT_BRANCH}`);
  console.log(`   Mode: ${IS_PRODUCTION ? "🟢 PRODUCTION" : "🟡 TEST"}`);
  console.log(`   Local: ${localDir}`);
  console.log(`   GCS: gs://${gcsBucket}/${gcsPath}/`);
  console.log(`\n📋 Files to upload (${filesToUpload.length}):\n`);

  for (const file of filesToUpload) {
    console.log(`   - ${file}`);
  }
  console.log();

  console.log("🚀 Starting upload...\n");

  let successCount = 0;
  let failCount = 0;

  for (const file of filesToUpload) {
    const localPath = `${localDir}/${file}`;
    const gcsDestination = `gs://${gcsBucket}/${gcsPath}/${file}`;

    try {
      console.log(`📤 Uploading ${file}...`);
      execSync(`gsutil cp "${localPath}" "${gcsDestination}"`, {
        encoding: "utf8",
        stdio: "inherit",
      });
      console.log(`   ✅ Success`);
      successCount++;
    } catch (error) {
      console.error(`   ❌ Failed: ${error}`);
      failCount++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 Upload Summary");
  console.log("=".repeat(60));
  console.log(`✅ Successful: ${successCount}/${filesToUpload.length}`);
  console.log(`❌ Failed: ${failCount}/${filesToUpload.length}`);
  console.log();

  if (successCount === filesToUpload.length) {
    console.log("🎉 All files uploaded successfully!");
  } else if (successCount > 0) {
    console.log("⚠️  Some files failed to upload. Check errors above.");
  } else {
    console.log("❌ All uploads failed. Check your GCS configuration.");
  }

  console.log(`\n📁 GCS Location: gs://${gcsBucket}/${gcsPath}/`);
  console.log();
}

uploadMissingFiles().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

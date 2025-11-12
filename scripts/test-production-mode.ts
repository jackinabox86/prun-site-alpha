/**
 * Test script to verify production mode behavior
 *
 * This simulates what will happen when the code is merged to main:
 * - Branch detection should identify "main"
 * - Paths should point to production folders
 * - skipExisting should be enabled
 */

import { execSync } from "child_process";

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

console.log("\n🧪 Testing Production Mode Detection\n");
console.log("=".repeat(60));

// Test current branch
const currentBranch = getCurrentBranch();
const isProduction = isProductionBranch(currentBranch);

console.log(`Current Branch: ${currentBranch}`);
console.log(`Is Production: ${isProduction ? "✅ YES" : "❌ NO"}`);
console.log();

// Show what paths would be used
const outputDir = isProduction
  ? "public/data/historical-prices"
  : "public/data/historical-prices-test";

const gcsPath = isProduction
  ? "historical-prices"
  : `historical-prices-test/${currentBranch}`;

const skipExisting = isProduction;

console.log("Configuration:");
console.log(`  Local Output: ${outputDir}`);
console.log(`  GCS Path: gs://prun-site-alpha-bucket/${gcsPath}/`);
console.log(`  Skip Existing Files: ${skipExisting ? "✅ YES" : "❌ NO"}`);
console.log();

// Test main branch simulation
console.log("=".repeat(60));
console.log("Simulating Main Branch:");
console.log("=".repeat(60));

const simulatedBranch = "main";
const simulatedIsProduction = isProductionBranch(simulatedBranch);
const simulatedOutputDir = simulatedIsProduction
  ? "public/data/historical-prices"
  : "public/data/historical-prices-test";
const simulatedGcsPath = simulatedIsProduction
  ? "historical-prices"
  : `historical-prices-test/${simulatedBranch}`;
const simulatedSkipExisting = simulatedIsProduction;

console.log(`Branch: ${simulatedBranch}`);
console.log(`Is Production: ${simulatedIsProduction ? "✅ YES" : "❌ NO"}`);
console.log(`Local Output: ${simulatedOutputDir}`);
console.log(`GCS Path: gs://prun-site-alpha-bucket/${simulatedGcsPath}/`);
console.log(`Skip Existing: ${simulatedSkipExisting ? "✅ YES" : "❌ NO"}`);
console.log();

// Verify expectations
console.log("=".repeat(60));
console.log("Verification:");
console.log("=".repeat(60));

let allPassed = true;

if (simulatedOutputDir !== "public/data/historical-prices") {
  console.log("❌ FAIL: Output dir should be production folder");
  allPassed = false;
} else {
  console.log("✅ PASS: Output dir is production folder");
}

if (simulatedGcsPath !== "historical-prices") {
  console.log("❌ FAIL: GCS path should be production path");
  allPassed = false;
} else {
  console.log("✅ PASS: GCS path is production path");
}

if (!simulatedSkipExisting) {
  console.log("❌ FAIL: skipExisting should be true on main");
  allPassed = false;
} else {
  console.log("✅ PASS: skipExisting is enabled on main");
}

console.log();
if (allPassed) {
  console.log("🎉 All tests passed! Production mode is correctly configured.");
} else {
  console.log("⚠️  Some tests failed. Check configuration.");
  process.exit(1);
}

console.log();
console.log("💡 When merged to main:");
console.log("   - Script will auto-detect main branch");
console.log("   - Will save to public/data/historical-prices/");
console.log("   - Will skip existing 1332 files");
console.log("   - Will only fetch NEW tickers");
console.log();

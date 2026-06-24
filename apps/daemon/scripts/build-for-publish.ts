/**
 * build-for-publish.ts
 *
 * Orchestrator that runs all build steps in order for npm CLI distribution.
 *
 * Flow:
 *   1. Clean dist/ and resources/
 *   2. tsc -p tsconfig.json (compile daemon source)
 *   3. tsx scripts/bundle-workspace.ts (esbuild vendor + import rewrite)
 *   4. pnpm --filter @open-design/web build (web static export)
 *   5. tsx scripts/copy-resources.ts (copy 10 resource trees + web)
 *   6. tsx scripts/validate-package.ts (pre-publish checks)
 *   7. npm pack --dry-run (verify package contents)
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getWorkspaceRoot } from "./lib/paths.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = resolve(SCRIPT_DIR, "..");
const WORKSPACE_ROOT = getWorkspaceRoot(DAEMON_ROOT);
const DIST_DIR = join(DAEMON_ROOT, "dist");
const RESOURCES_DIR = join(DAEMON_ROOT, "resources");

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHeader(step: number, description: string): void {
  const bar = "═".repeat(60);
  console.log(`\n${bar}`);
  console.log(`  Step ${step}: ${description}`);
  console.log(`${bar}\n`);
}

function runStep(command: string, cwd: string, description: string): void {
  console.log(`  Running: ${command}`);
  try {
    execSync(command, { cwd, stdio: "inherit" });
    console.log(`  ✓ ${description} complete\n`);
  } catch (error) {
    console.error(`\n  ✗ Step failed: ${description}`);
    console.error(`  Command: ${command}`);
    if (error instanceof Error) {
      console.error(`  ${error.message}`);
    }
    process.exit(1);
  }
}

// workspace:* deps are handled natively by pnpm pack/publish.
// pnpm automatically converts them to real versions during packing.
// No manual stripping needed — see https://pnpm.io/workspaces#publishing-workspace-packages

// ── Steps ────────────────────────────────────────────────────────────────────

function step1Clean(): void {
  printHeader(1, "Clean dist/ and resources/");

  if (existsSync(DIST_DIR)) {
    console.log("  Removing dist/...");
    rmSync(DIST_DIR, { recursive: true, force: true });
  }
  mkdirSync(DIST_DIR, { recursive: true });
  console.log("  ✓ dist/ recreated");

  if (existsSync(RESOURCES_DIR)) {
    console.log("  Removing resources/...");
    rmSync(RESOURCES_DIR, { recursive: true, force: true });
  }
  // resources/ will be created by copy-resources.ts
  console.log("  ✓ resources/ cleaned");
}

function step2CompileDaemon(): void {
  printHeader(2, "Compile daemon source (tsc)");
  runStep("pnpm exec tsc -p tsconfig.json", DAEMON_ROOT, "Daemon tsc compile");
}

function step3BundleWorkspace(): void {
  printHeader(3, "Bundle workspace deps + rewrite imports");
  runStep(
    "pnpm exec tsx scripts/bundle-workspace.ts",
    DAEMON_ROOT,
    "Workspace bundle + import rewrite",
  );
}

function step4BuildWeb(): void {
  printHeader(4, "Build web static export");
  runStep(
    "pnpm --filter @open-design/web build",
    WORKSPACE_ROOT,
    "Web static export build",
  );
}

function step5CopyResources(): void {
  printHeader(5, "Copy resource trees + web app");
  runStep(
    "pnpm exec tsx scripts/copy-resources.ts",
    DAEMON_ROOT,
    "Resource copy",
  );
}

function step6Validate(): void {
  printHeader(6, "Pre-publish validation");
  runStep(
    "pnpm exec tsx scripts/validate-package.ts",
    DAEMON_ROOT,
    "Package validation",
  );
}

function step7DryRunPack(): void {
  printHeader(7, "pnpm pack --dry-run (verify package contents)");
  // pnpm pack natively converts workspace:* to real versions.
  // No manual stripping needed.
  runStep("pnpm pack --dry-run", DAEMON_ROOT, "pnpm pack dry-run");
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  build-for-publish.ts — npm CLI distribution build          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  step1Clean();
  step2CompileDaemon();
  step3BundleWorkspace();
  step4BuildWeb();
  step5CopyResources();
  step6Validate();
  step7DryRunPack();

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  ✓ build-for-publish.ts complete                           ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
}

main();

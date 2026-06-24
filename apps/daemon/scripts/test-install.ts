#!/usr/bin/env tsx

/**
 * test-install.ts
 *
 * Docker-based artifact install verification for @open-design/daemon npm package.
 *
 * Flow:
 *   1. Check docker availability (skip gracefully if not available)
 *   2. Build Docker image from Dockerfile.test
 *   3. npm pack to produce .tgz
 *   4. Run container: install .tgz, smoke-test od CLI
 *   5. Check exit code, report results
 *   6. Cleanup (remove .tgz, keep image for reuse)
 *
 * Usage:
 *   pnpm --filter @open-design/daemon exec tsx scripts/test-install.ts
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Constants ────────────────────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = resolve(SCRIPT_DIR, "..");
const DOCKERFILE = resolve(SCRIPT_DIR, "Dockerfile.test");
const IMAGE_TAG = "open-design-test-install";
const BASE_PORT = 17456;
const DAEMON_START_WAIT_SEC = 8;

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHeader(step: number, description: string): void {
  const bar = "═".repeat(60);
  console.log(`\n${bar}`);
  console.log(`  Step ${step}: ${description}`);
  console.log(`${bar}\n`);
}

function run(command: string, cwd?: string): void {
  console.log(`  Running: ${command}`);
  try {
    execSync(command, { cwd, stdio: "inherit" });
  } catch (error) {
    console.error(`\n  ✗ Command failed: ${command}`);
    if (error instanceof Error) {
      console.error(`  ${error.message}`);
    }
    process.exit(1);
  }
}

function checkDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function randomPort(): number {
  return BASE_PORT + Math.floor(Math.random() * 1000);
}

// workspace:* deps are handled natively by pnpm pack/publish.
// pnpm automatically converts them to real versions during packing.
// No manual stripping needed — see https://pnpm.io/workspaces#publishing-workspace-packages

// ── Steps ────────────────────────────────────────────────────────────────────

function step1CheckDocker(): void {
  printHeader(1, "Check docker availability");

  if (!checkDockerAvailable()) {
    console.log("  ⚠ Docker is not available. Skipping test-install.");
    console.log("  This is expected in CI environments without Docker.");
    console.log("  Exiting with code 0 (skip, not fail).");
    process.exit(0);
  }

  console.log("  ✓ Docker is available");
}

function step2BuildImage(): void {
  printHeader(2, "Build Docker test image");

  if (!existsSync(DOCKERFILE)) {
    console.error(`  ✗ Dockerfile not found: ${DOCKERFILE}`);
    process.exit(1);
  }

  run(`docker build -t ${IMAGE_TAG} -f "${DOCKERFILE}" "${SCRIPT_DIR}"`);
  console.log("  ✓ Docker image built");
}

function step3PnpmPack(): string {
  printHeader(3, "pnpm pack (produce .tgz)");
  // pnpm pack natively converts workspace:* to real versions.

  // Clean up any existing .tgz files from previous runs
  const existingTgzs = readdirSync(DAEMON_ROOT).filter((f) =>
    f.endsWith(".tgz"),
  );
  for (const f of existingTgzs) {
    unlinkSync(resolve(DAEMON_ROOT, f));
    console.log(`  Cleaned up existing: ${f}`);
  }

  run("pnpm pack", DAEMON_ROOT);

  // Find the produced .tgz
  const tgzFiles = readdirSync(DAEMON_ROOT).filter((f) => f.endsWith(".tgz"));
  if (tgzFiles.length === 0) {
    console.error("  ✗ pnpm pack did not produce a .tgz file");
    process.exit(1);
  }

  const tgzPath = resolve(DAEMON_ROOT, tgzFiles[0]!);
  console.log(`  ✓ Produced: ${tgzFiles[0]}`);
  return tgzPath;
}

function step4RunContainer(tgzPath: string): void {
  printHeader(4, "Run Docker container smoke tests");

  const port = randomPort();
  console.log(`  Using port: ${port}`);

  // Build the container script as a single bash script.
  // Each smoke test is a separate step with a visible header.
  // set -e ensures any failing command aborts the container immediately.
  const containerScript = [
    "set -e",
    'echo "=== Installing package ==="',
    "npm install -g /test/pkg.tgz",
    'echo "=== Checking binary ==="',
    "which od",
    'echo "=== od --help ==="',
    "od --help",
    'echo "=== Starting daemon ==="',
    `od daemon start --no-open --port ${port} &`,
    `sleep ${DAEMON_START_WAIT_SEC}`,
    'echo "=== od version ==="',
    `od version --daemon-url http://127.0.0.1:${port}`,
    'echo "=== od daemon status ==="',
    `od daemon status --json --daemon-url http://127.0.0.1:${port}`,
    'echo "=== od mcp install --print ==="',
    `od mcp install --print codex --daemon-url http://127.0.0.1:${port}`,
    'echo "=== od doctor ==="',
    `od doctor --json --daemon-url http://127.0.0.1:${port} || true`,
    'echo "=== Stopping daemon ==="',
    "kill %1",
    "wait %1 2>/dev/null || true",
    'echo "=== All smoke tests passed ==="',
  ].join("\n");

  // The container script is passed as a single-quoted argument to bash -c.
  // Single quotes prevent the outer shell from interpreting any characters
  // inside the script. The script itself contains no single quotes, so this
  // is safe.
  const dockerCmd = [
    "docker",
    "run",
    "--rm",
    "-v",
    `${tgzPath}:/test/pkg.tgz`,
    IMAGE_TAG,
    "bash",
    "-c",
    `'${containerScript}'`,
  ].join(" ");

  console.log("  Container smoke test script:");
  for (const line of containerScript.split("\n")) {
    console.log(`    ${line}`);
  }
  console.log();

  run(dockerCmd);
  console.log("\n  ✓ Container smoke tests passed");
}

function step5Cleanup(tgzPath: string): void {
  printHeader(5, "Cleanup");

  // Remove the .tgz file produced by npm pack
  if (existsSync(tgzPath)) {
    unlinkSync(tgzPath);
    console.log(`  ✓ Removed: ${tgzPath}`);
  }

  console.log(
    `  ✓ Docker image kept for reuse (remove with: docker rmi ${IMAGE_TAG})`,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log(
    "╔══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║  test-install.ts — Docker artifact install verification     ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝",
  );

  step1CheckDocker();
  step2BuildImage();
  const tgzPath = step3PnpmPack();
  step4RunContainer(tgzPath);
  step5Cleanup(tgzPath);

  console.log(
    "\n╔══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║  ✓ test-install.ts complete — all smoke tests passed       ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝",
  );
}

main();

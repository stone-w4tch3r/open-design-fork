/**
 * copy-resources.ts
 *
 * Copies all resource trees and the web app into apps/daemon/resources/.
 *
 * Resource trees (from BUNDLED_RESOURCE_TREES in tools/pack/src/resources.ts):
 *   skills/              -> resources/skills/
 *   design-templates/    -> resources/design-templates/
 *   design-systems/      -> resources/design-systems/
 *   craft/               -> resources/craft/
 *   plugins/_official/   -> resources/plugins/_official/
 *   plugins/registry/    -> resources/plugins/registry/
 *   assets/frames/       -> resources/frames/
 *   assets/community-pets/ -> resources/community-pets/
 *   prompt-templates/    -> resources/prompt-templates/
 *   data/plugin-previews/ -> resources/data/plugin-previews/
 *
 * Web app:
 *   Builds apps/web (pnpm --filter @open-design/web build)
 *   Copies apps/web/out/ -> resources/web/
 */

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getWorkspaceRoot } from "./lib/paths.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = resolve(SCRIPT_DIR, "..");
const WORKSPACE_ROOT = getWorkspaceRoot(DAEMON_ROOT);
const RESOURCES_DIR = join(DAEMON_ROOT, "resources");

/**
 * Resource trees to copy. Mirrors BUNDLED_RESOURCE_TREES from
 * tools/pack/src/resources.ts, with the addition of the web app.
 */
const RESOURCE_TREES: Array<{ from: string; to: string; description: string }> = [
  { from: "skills", to: "skills", description: "Skills" },
  { from: "design-templates", to: "design-templates", description: "Design templates" },
  { from: "design-systems", to: "design-systems", description: "Design systems" },
  { from: "craft", to: "craft", description: "Craft rules" },
  { from: join("plugins", "_official"), to: join("plugins", "_official"), description: "Official plugins" },
  { from: join("plugins", "registry"), to: join("plugins", "registry"), description: "Plugin registry" },
  { from: join("assets", "frames"), to: "frames", description: "Frames" },
  { from: join("assets", "community-pets"), to: "community-pets", description: "Community pets" },
  { from: "prompt-templates", to: "prompt-templates", description: "Prompt templates" },
  { from: join("data", "plugin-previews"), to: join("data", "plugin-previews"), description: "Plugin previews" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function cleanResourcesDir(): void {
  if (existsSync(RESOURCES_DIR)) {
    console.log(`  Removing existing resources/ directory...`);
    rmSync(RESOURCES_DIR, { recursive: true, force: true });
  }
  mkdirSync(RESOURCES_DIR, { recursive: true });
  console.log(`  ✓ resources/ directory ready`);
}

function copyResourceTree(fromRel: string, toRel: string, description: string): void {
  const sourcePath = join(WORKSPACE_ROOT, fromRel);
  const targetPath = join(RESOURCES_DIR, toRel);

  if (!existsSync(sourcePath)) {
    console.warn(`  ⚠ ${description}: source not found at ${fromRel}, skipping`);
    return;
  }

  // Ensure parent directory exists
  const targetParent = dirname(targetPath);
  if (!existsSync(targetParent)) {
    mkdirSync(targetParent, { recursive: true });
  }

  console.log(`  Copying ${description}: ${fromRel} -> resources/${toRel}`);
  cpSync(sourcePath, targetPath, { recursive: true });
  console.log(`  ✓ ${description} copied`);
}

function buildAndCopyWebApp(): void {
  console.log(`  Building web app (pnpm --filter @open-design/web build)...`);
  execSync("pnpm --filter @open-design/web build", {
    cwd: WORKSPACE_ROOT,
    stdio: "inherit",
  });

  const webOutDir = join(WORKSPACE_ROOT, "apps", "web", "out");
  const webTargetDir = join(RESOURCES_DIR, "web");

  if (!existsSync(webOutDir)) {
    throw new Error(`Web build output not found at apps/web/out/`);
  }

  console.log(`  Copying web app: apps/web/out/ -> resources/web/`);
  cpSync(webOutDir, webTargetDir, { recursive: true });
  console.log(`  ✓ Web app copied`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log("=== copy-resources.ts ===\n");

  // Step 1: Clean and recreate resources/
  console.log("── Step 1: Prepare resources/ directory ──\n");
  cleanResourcesDir();

  // Step 2: Copy resource trees
  console.log("\n── Step 2: Copy resource trees ──\n");
  for (const { from, to, description } of RESOURCE_TREES) {
    copyResourceTree(from, to, description);
  }

  // Step 3: Build and copy web app
  console.log("\n── Step 3: Build and copy web app ──\n");
  buildAndCopyWebApp();

  console.log("\n✓ copy-resources.ts complete");
}

main();

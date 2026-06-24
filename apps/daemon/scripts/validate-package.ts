#!/usr/bin/env tsx

/**
 * Pre-publish validation for @open-design/daemon npm package.
 *
 * Checks package.json metadata and filesystem state to confirm the package
 * is ready for `npm publish`. Exits 0 on all-pass, 1 on any failure.
 *
 * Usage:
 *   pnpm --filter @open-design/daemon exec tsx scripts/validate-package.ts
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const packageJsonPath = resolve(packageDir, "package.json");
const distDir = resolve(packageDir, "dist");
const distCliPath = resolve(distDir, "cli.js");
const binOdPath = resolve(packageDir, "bin", "od-cli.mjs");
const resourcesDir = resolve(packageDir, "resources");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CheckResult {
  label: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function add(label: string, pass: boolean, detail: string): void {
  results.push({ label, pass, detail });
}

function failExit(): never {
  let passCount = 0;
  let failCount = 0;

  console.log("\n=== Validation Results ===\n");

  for (const r of results) {
    const icon = r.pass ? "PASS" : "FAIL";
    console.log(`  ${icon}  ${r.label}`);
    if (!r.pass) {
      console.log(`       ${r.detail}`);
      failCount++;
    } else {
      passCount++;
    }
  }

  console.log(`\n---`);
  console.log(`  ${passCount} passed, ${failCount} failed`);

  if (failCount > 0) {
    console.log("\n  OVERALL: FAIL — fix the issues above before publishing.\n");
    process.exit(1);
  }

  console.log("\n  OVERALL: PASS — package is ready for publish.\n");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 1. Read and validate package.json
// ---------------------------------------------------------------------------

let pkg: Record<string, unknown>;

try {
  const raw = readFileSync(packageJsonPath, "utf-8");
  pkg = JSON.parse(raw);
  add("package.json is valid JSON", true, "");
} catch (err) {
  add("package.json is valid JSON", false, String(err));
  failExit();
}

// 1a. private must not be true
const isPrivate = pkg.private === true;
add(
  "package.json is not private",
  !isPrivate,
  isPrivate ? '"private": true is set — remove it for public publish' : "",
);

// 1b. files must include bin, dist, resources
const files = Array.isArray(pkg.files) ? (pkg.files as string[]) : [];
const requiredFiles = ["bin", "dist", "resources"];
const missingFiles = requiredFiles.filter((f) => !files.includes(f));
add(
  '"files" includes bin, dist, resources',
  missingFiles.length === 0,
  missingFiles.length > 0
    ? `Missing from "files": ${missingFiles.join(", ")}`
    : "",
);

// 1c. engines.node must be ~24
const engines = (pkg.engines as Record<string, string> | undefined) ?? {};
const nodeEngine = engines.node ?? "";
add(
  'engines.node is "~24"',
  nodeEngine === "~24",
  nodeEngine
    ? `engines.node is "${nodeEngine}", expected "~24"`
    : "engines.node is not set",
);

// 1d. better-sqlite3 and node-pty must be in dependencies
const deps = (pkg.dependencies as Record<string, string> | undefined) ?? {};
const requiredDeps = ["better-sqlite3", "node-pty"];
const missingDeps = requiredDeps.filter((d) => !(d in deps));
add(
  "better-sqlite3 and node-pty are in dependencies",
  missingDeps.length === 0,
  missingDeps.length > 0
    ? `Missing from dependencies: ${missingDeps.join(", ")}`
    : "",
);

// 1e. No @open-design/* imports remain in dist/ after bundling.
// The bundle step (bundle-workspace.ts) bundles workspace deps into
// dist/vendor/ and rewrites all @open-design/* imports in dist/**/*.js
// to relative vendor paths. This check verifies the bundle step worked.
const distJsFiles = existsSync(distDir)
  ? readdirSync(distDir, { recursive: true, encoding: "utf8" }).filter(
      (f) => f.endsWith(".js") || f.endsWith(".mjs"),
    )
  : [];
const openDesignImportPattern =
  /(?:from\s+['"]@open-design\/|import\s*\(\s*['"]@open-design\/)/;
const remainingImports: string[] = [];

for (const relFile of distJsFiles) {
  const absFile = join(distDir, relFile);
  const content = readFileSync(absFile, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (openDesignImportPattern.test(lines[i])) {
      remainingImports.push(`${relFile}:${i + 1}`);
    }
  }
}

add(
  "No @open-design/* imports remain in dist/ after bundling",
  remainingImports.length === 0,
  remainingImports.length > 0
    ? `Found ${remainingImports.length} remaining @open-design/* import(s):\n       ${remainingImports.join("\n       ")}`
    : "",
);

// ---------------------------------------------------------------------------
// 2. Filesystem checks
// ---------------------------------------------------------------------------

// 2a. dist/cli.js exists
add(
  "dist/cli.js exists",
  existsSync(distCliPath),
  existsSync(distCliPath) ? "" : `File not found: ${distCliPath}`,
);

// 2b. bin/od.mjs exists
add(
  "bin/od-cli.mjs exists",
  existsSync(binOdPath),
  existsSync(binOdPath) ? "" : `File not found: ${binOdPath}`,
);

// 2c. resources/ directory
if (!existsSync(resourcesDir)) {
  add(
    "resources/ directory exists",
    false,
    `Directory not found: ${resourcesDir}. Run build:publish first.`,
  );
} else {
  add("resources/ directory exists", true, "");

  // 2d. Key subdirectories under resources/
  const keySubdirs = ["skills", "design-systems", "craft", "frames", "web"];
  for (const sub of keySubdirs) {
    const subPath = resolve(resourcesDir, sub);
    const exists = existsSync(subPath);
    add(
      `resources/${sub}/ exists`,
      exists,
      exists ? "" : `Directory not found: ${subPath}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. bin/od-cli.mjs sets OD_RESOURCE_ROOT
// ---------------------------------------------------------------------------

if (existsSync(binOdPath)) {
  const binContent = readFileSync(binOdPath, "utf-8");
  const hasResourceRoot = binContent.includes("OD_RESOURCE_ROOT");
  add(
    "bin/od-cli.mjs sets OD_RESOURCE_ROOT",
    hasResourceRoot,
    hasResourceRoot
      ? ""
      : "OD_RESOURCE_ROOT is not referenced in bin/od-cli.mjs. The entrypoint must set it for packaged resource resolution.",
  );
} else {
  add(
    "bin/od-cli.mjs sets OD_RESOURCE_ROOT",
    false,
    "bin/od-cli.mjs does not exist — cannot check OD_RESOURCE_ROOT",
  );
}

// ---------------------------------------------------------------------------
// Final summary
// ---------------------------------------------------------------------------

failExit();

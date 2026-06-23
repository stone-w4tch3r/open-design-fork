/**
 * bundle-workspace.ts
 *
 * Bundles all 9 workspace dependencies into dist/vendor/ and rewrites
 * @open-design/* imports in dist/**\/*.js to point at the vendor files.
 *
 * Part A: esbuild bundle each workspace dep into dist/vendor/<pkg>.mjs
 * Part B: handle contracts subpath exports as separate vendor entries
 * Part C: regex-rewrite all @open-design/* imports in dist/**\/*.js
 *
 * Externalized: other workspace deps, native deps, npm deps, node builtins.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getWorkspaceRoot } from "./lib/paths.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = resolve(SCRIPT_DIR, "..");
const WORKSPACE_ROOT = getWorkspaceRoot(DAEMON_ROOT);
const DIST_DIR = join(DAEMON_ROOT, "dist");
const VENDOR_DIR = join(DIST_DIR, "vendor");

/** The 9 workspace deps the daemon depends on (from package.json dependencies). */
const WORKSPACE_DEPS = [
  "agui-adapter",
  "contracts",
  "diagnostics",
  "platform",
  "plugin-runtime",
  "release",
  "registry-protocol",
  "sidecar",
  "sidecar-proto",
] as const;

/** Native deps that must stay external (require C++ build toolchain). */
const NATIVE_DEPS = ["better-sqlite3", "blake3-wasm", "node-pty"];

/** Npm deps from daemon's package.json dependencies (excluding workspace:* ones). */
const NPM_DEPS = [
  "@modelcontextprotocol/sdk",
  "@opentelemetry/api",
  "cheerio",
  "chokidar",
  "express",
  "jszip",
  "multer",
  "posthog-node",
  "prom-client",
  "tar",
  "undici",
  "zod",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function readPackageJson(pkgDir: string): Record<string, unknown> {
  const raw = readFileSync(join(pkgDir, "package.json"), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function getPackageSourceEntry(pkgName: string): string {
  const pkgDir = join(WORKSPACE_ROOT, "packages", pkgName);
  const pkgJson = readPackageJson(pkgDir);
  // Most packages have a single src/index.ts entry
  return join(pkgDir, "src", "index.ts");
}

/**
 * Read contracts package.json exports field to discover all subpath exports.
 * Returns a list of { subpath, sourceFile } entries.
 */
function getContractsSubpathExports(): Array<{ subpath: string; sourceFile: string }> {
  const pkgDir = join(WORKSPACE_ROOT, "packages", "contracts");
  const pkgJson = readPackageJson(pkgDir);
  const exports = pkgJson.exports as Record<string, unknown> | undefined;
  if (!exports) return [];

  const entries: Array<{ subpath: string; sourceFile: string }> = [];

  for (const [key, value] of Object.entries(exports)) {
    // Skip the main "." entry and the package.json export
    if (key === "." || key === "./package.json") continue;

    // The subpath key looks like "./api/connectionTest" or "./analytics"
    // Most source files are at src/<subpath>.ts, but some use src/<subpath>/index.ts
    const subpath = key.replace(/^\.\//, "");
    const directFile = join(pkgDir, "src", `${subpath}.ts`);
    const indexFile = join(pkgDir, "src", subpath, "index.ts");

    if (existsSync(directFile)) {
      entries.push({ subpath, sourceFile: directFile });
    } else if (existsSync(indexFile)) {
      entries.push({ subpath, sourceFile: indexFile });
    } else {
      console.warn(`  ⚠ contracts subpath "${key}" has no matching source file (tried ${directFile} and ${indexFile}), skipping`);
    }
  }

  return entries;
}

/**
 * Build the esbuild external list for bundling a specific workspace dep.
 * We externalize:
 *  - All OTHER workspace deps (so they stay as import references)
 *  - Native deps
 *  - All npm deps
 *  - Node builtins (via wildcard)
 */
function buildExternalList(currentPkg: string): string[] {
  const externals: string[] = [];

  // Other workspace deps
  for (const dep of WORKSPACE_DEPS) {
    if (dep !== currentPkg) {
      externals.push(`@open-design/${dep}`);
    }
  }

  // Contracts subpath exports (when bundling something other than contracts)
  if (currentPkg !== "contracts") {
    // We need to externalize all contracts subpaths too
    // The main @open-design/contracts is already covered above
    // Subpaths like @open-design/contracts/api/connectionTest need separate entries
    const subpathExports = getContractsSubpathExports();
    for (const { subpath } of subpathExports) {
      externals.push(`@open-design/contracts/${subpath}`);
    }
  }

  // Native deps
  externals.push(...NATIVE_DEPS);

  // Npm deps
  externals.push(...NPM_DEPS);

  return externals;
}

/**
 * Convert a contracts subpath like "api/connectionTest" to a safe filename
 * like "contracts-api-connectionTest".
 */
function subpathToVendorName(subpath: string): string {
  return `contracts-${subpath.replace(/\//g, "-")}`;
}

// ── Part A: Bundle workspace deps ────────────────────────────────────────────

function bundleWorkspaceDep(pkgName: string): void {
  const entry = getPackageSourceEntry(pkgName);
  const outfile = join(VENDOR_DIR, `${pkgName}.mjs`);
  const externals = buildExternalList(pkgName);

  console.log(`  Bundling @open-design/${pkgName}...`);
  console.log(`    entry: ${relative(WORKSPACE_ROOT, entry)}`);
  console.log(`    outfile: ${relative(DAEMON_ROOT, outfile)}`);

  const externalArgs = externals.map((e) => `--external:${e}`);

  const args = [
    entry,
    "--bundle",
    "--format=esm",
    "--platform=node",
    "--target=node24",
    `--outfile=${outfile}`,
    "--out-extension:.js=.mjs",
    "--external:node:*",
    ...externalArgs,
  ];

  execSync(`pnpm exec esbuild ${args.join(" ")}`, {
    cwd: DAEMON_ROOT,
    stdio: "inherit",
  });

  console.log(`  ✓ @open-design/${pkgName} bundled`);
}

// ── Part B: Bundle contracts subpath exports ─────────────────────────────────

function bundleContractsSubpaths(): void {
  const subpathExports = getContractsSubpathExports();
  if (subpathExports.length === 0) {
    console.log("  No contracts subpath exports to bundle.");
    return;
  }

  console.log(`  Bundling ${subpathExports.length} contracts subpath exports...`);

  // When bundling a contracts subpath, externalize everything except contracts itself
  // (the subpath file may import from the main contracts entry or other subpaths)
  const externals = buildExternalList("contracts");

  for (const { subpath, sourceFile } of subpathExports) {
    const vendorName = subpathToVendorName(subpath);
    const outfile = join(VENDOR_DIR, `${vendorName}.mjs`);

    console.log(`    @open-design/contracts/${subpath} -> ${vendorName}.mjs`);

    const externalArgs = externals.map((e) => `--external:${e}`);

    const args = [
      sourceFile,
      "--bundle",
      "--format=esm",
      "--platform=node",
      "--target=node24",
      `--outfile=${outfile}`,
      "--out-extension:.js=.mjs",
      "--external:node:*",
      ...externalArgs,
    ];

    execSync(`pnpm exec esbuild ${args.join(" ")}`, {
      cwd: DAEMON_ROOT,
      stdio: "inherit",
    });
  }

  console.log(`  ✓ contracts subpath exports bundled`);
}

// ── Part C: Rewrite imports ──────────────────────────────────────────────────

/**
 * Build the rewrite map: import specifier -> relative vendor path.
 *
 * The relative path is computed from dist/vendor/ to each file's location.
 * We pre-compute the map once, then apply it per-file.
 */
function buildRewriteMap(): Map<string, string> {
  const map = new Map<string, string>();

  // Main workspace deps
  for (const pkg of WORKSPACE_DEPS) {
    map.set(`@open-design/${pkg}`, `./vendor/${pkg}.mjs`);
  }

  // Contracts subpath exports
  const subpathExports = getContractsSubpathExports();
  for (const { subpath } of subpathExports) {
    const vendorName = subpathToVendorName(subpath);
    map.set(`@open-design/contracts/${subpath}`, `./vendor/${vendorName}.mjs`);
  }

  return map;
}

/**
 * Compute the relative import path from a given dist file to dist/vendor/.
 *
 * Example:
 *   file: dist/cli.js          -> ./vendor/
 *   file: dist/routes/chat.js  -> ../vendor/
 *   file: dist/a/b/c.js        -> ../../../vendor/
 */
function vendorPrefixForFile(filePath: string): string {
  const fileDir = dirname(filePath);
  let rel = relative(fileDir, VENDOR_DIR);
  // Ensure it starts with ./ or ../
  if (!rel.startsWith(".")) {
    rel = `./${rel}`;
  }
  // Ensure trailing slash
  if (!rel.endsWith("/")) {
    rel = `${rel}/`;
  }
  return rel;
}

/**
 * Rewrite @open-design/* imports in a single .js file.
 *
 * Handles:
 *   - Static imports: from '@open-design/xxx' and from "@open-design/xxx"
 *   - Dynamic imports: import('@open-design/xxx') and import("@open-design/xxx")
 *
 * Does NOT rewrite:
 *   - require.resolve('@open-design/daemon/package.json') (self-reference)
 *   - JSDoc type imports (already erased by tsc)
 */
function rewriteImportsInFile(filePath: string, rewriteMap: Map<string, string>): boolean {
  let content = readFileSync(filePath, "utf8");
  let changed = false;
  const vendorPrefix = vendorPrefixForFile(filePath);

  for (const [specifier, vendorRelPath] of rewriteMap) {
    // The vendorRelPath is relative to dist/vendor/ (e.g. ./vendor/contracts.mjs)
    // We need to make it relative to the current file's directory
    const fullRelPath = vendorRelPath.replace("./vendor/", vendorPrefix);

    // Escape the specifier for regex (dots and slashes)
    const escapedSpecifier = specifier.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

    // Pattern 1: Static imports — from 'specifier' or from "specifier"
    // Must be preceded by 'from' keyword to avoid matching require.resolve paths
    const staticPattern = new RegExp(
      `(from\\s+['"])${escapedSpecifier}(['"])`,
      "g",
    );

    const newContent = content.replace(staticPattern, `$1${fullRelPath}$2`);
    if (newContent !== content) {
      changed = true;
      content = newContent;
    }

    // Pattern 2: Dynamic imports — import('specifier') or import("specifier")
    const dynamicPattern = new RegExp(
      `(import\\s*\\(\\s*['"])${escapedSpecifier}(['"]\\s*\\))`,
      "g",
    );

    const newContent2 = content.replace(dynamicPattern, `$1${fullRelPath}$2`);
    if (newContent2 !== content) {
      changed = true;
      content = newContent2;
    }
  }

  if (changed) {
    writeFileSync(filePath, content, "utf8");
  }

  return changed;
}

function rewriteAllImports(): void {
  const rewriteMap = buildRewriteMap();
  console.log(`  Rewrite map has ${rewriteMap.size} entries`);

  // Find all .js and .mjs files in dist/ recursively.
  // Vendor .mjs files must be included because esbuild externalizes
  // cross-workspace imports (e.g. sidecar-proto.mjs still imports
  // @open-design/release at runtime). Those imports need the same
  // relative-path rewrite as non-vendor files.
  const distFiles = readdirSync(DIST_DIR, {
    recursive: true,
    encoding: "utf8",
  }).filter((f) => f.endsWith(".js") || f.endsWith(".mjs"));

  let rewrittenCount = 0;

  for (const relFile of distFiles) {
    const absFile = join(DIST_DIR, relFile);
    const wasRewritten = rewriteImportsInFile(absFile, rewriteMap);
    if (wasRewritten) {
      rewrittenCount += 1;
    }
  }

  console.log(`  ✓ Rewritten imports in ${rewrittenCount} of ${distFiles.length} dist files`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log("=== bundle-workspace.ts ===\n");

  // Ensure vendor directory exists
  if (!existsSync(VENDOR_DIR)) {
    mkdirSync(VENDOR_DIR, { recursive: true });
  }

  // Part A: Bundle each workspace dep
  console.log("── Part A: Bundling workspace dependencies ──\n");
  for (const pkg of WORKSPACE_DEPS) {
    bundleWorkspaceDep(pkg);
  }

  // Part B: Bundle contracts subpath exports
  console.log("\n── Part B: Bundling contracts subpath exports ──\n");
  bundleContractsSubpaths();

  // Part C: Rewrite imports
  console.log("\n── Part C: Rewriting @open-design/* imports ──\n");
  rewriteAllImports();

  console.log("\n✓ bundle-workspace.ts complete");
}

main();

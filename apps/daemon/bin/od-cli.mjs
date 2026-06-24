#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const entryDir = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(entryDir, "../dist/cli.js");

if (!existsSync(distEntry)) {
  throw new Error(
    "Open Design daemon is not built. Reinstall the package or run 'od-cli doctor'."
  );
}

// Set resource root to package directory so daemon finds bundled resources.
// In dev mode (monorepo), OD_RESOURCE_ROOT is not set and daemon falls back
// to project-relative paths. In packaged/npm mode, we point at the bundled
// resources/ directory shipped with the package.
if (!process.env.OD_RESOURCE_ROOT) {
  const packageRoot = resolve(entryDir, "..");
  const resourceRoot = resolve(packageRoot, "resources");
  if (existsSync(resourceRoot)) {
    process.env.OD_RESOURCE_ROOT = resourceRoot;
  }
}

await import(pathToFileURL(distEntry).href);

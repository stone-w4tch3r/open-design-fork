# npm CLI Distribution Plan

> Design doc for PR: publish `@open-design/daemon` as a public npm package with `od` CLI.
> Mimics desktop packaged app resource bundling. Does not alter existing release pipeline.

## Design decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Workspace deps | Bundle via esbuild into `dist/` | Same as desktop's mac-prebundle approach. Avoids publishing 9 separate packages. |
| Resource dirs | Include all 10 trees from `BUNDLED_RESOURCE_TREES` | Mimic desktop exactly. Total ~141 MB, within npm limits. |
| Web app | Bundle pre-built static export | Same as desktop (desktop bundles Next.js standalone; we bundle static export). |
| Native deps | List as regular deps, document build toolchain | Same as desktop: users need C++ toolchain for `better-sqlite3` and `node-pty`. |
| Path resolution | Set `OD_RESOURCE_ROOT` in `bin/od.mjs` before daemon import | Same pattern as desktop's `createPackagedDaemonManagedPathEnv`. |
| Publishing | `npm publish` from local script only | Do not alter existing GitHub release workflows. |

## Resource bundling (mimics desktop)

Desktop copies these 10 trees into `<resourcesPath>/open-design/` and sets `OD_RESOURCE_ROOT` there.
We copy them into `<package-root>/resources/` and set `OD_RESOURCE_ROOT` there.

| Workspace source | Resource root target | Size |
| --- | --- | --- |
| `skills/` | `resources/skills/` | 2.9 MB |
| `design-templates/` | `resources/design-templates/` | 39 MB |
| `design-systems/` | `resources/design-systems/` | 29 MB |
| `craft/` | `resources/craft/` | 136 KB |
| `plugins/_official/` | `resources/plugins/_official/` | 56 MB |
| `plugins/registry/` | `resources/plugins/registry/` | 424 KB |
| `assets/frames/` | `resources/frames/` | 36 KB |
| `assets/community-pets/` | `resources/community-pets/` | 13 MB |
| `prompt-templates/` | `resources/prompt-templates/` | 588 KB |
| `data/plugin-previews/` | `resources/data/plugin-previews/` | varies |
| `apps/web/out/` | `resources/web/` | ~5-20 MB (after build) |

Total: ~155-170 MB. npm allows packages up to several hundred MB.

## Scripts (scripts-first, locally runnable)

All build logic lives in `apps/daemon/scripts/`. Workflows are thin wrappers.

```text
apps/daemon/scripts/
├── build-for-publish.ts    Orchestrator: runs all steps in order
├── bundle-workspace.ts     esbuild bundle of workspace deps into dist/
├── copy-resources.ts       Copy 10 resource trees + web app into resources/
├── validate-package.ts     Pre-publish checks: files, version, native deps, resource roots
├── test-install.ts         Install from local tarball, smoke-test od commands
└── lib/                    Shared helpers (paths, exec, reporting)
```

### Commands

```bash
# Build everything for publish
pnpm --filter @open-design/daemon exec tsx scripts/build-for-publish.ts

# Validate package before publish
pnpm --filter @open-design/daemon exec tsx scripts/validate-package.ts

# Test install from local tarball
pnpm --filter @open-design/daemon exec tsx scripts/test-install.ts

# Pack (dry-run)
pnpm --filter @open-design/daemon pack --dry-run

# Pack (real)
pnpm --filter @open-design/daemon pack
```

### build-for-publish.ts flow

```text
1. Clean dist/ and resources/
2. tsc -p tsconfig.json                    (compile daemon source)
3. bundle-workspace.ts                     (esbuild workspace deps into dist/)
4. pnpm --filter @open-design/web build    (build web static export)
5. copy-resources.ts                       (copy 10 resource trees + web/out)
6. validate-package.ts                     (check files, version, native deps)
7. npm pack --dry-run                      (verify package contents)
```

### validate-package.ts checks

- `package.json` is not private
- `files` array includes `bin`, `dist`, `resources`
- `engines.node` is `~24`
- `OD_RESOURCE_ROOT` resolution works from `bin/od.mjs`
- All 10 resource segments exist under `resources/`
- `resources/web/` exists and contains `index.html`
- `better-sqlite3` and `node-pty` are in `dependencies`
- No `workspace:*` references remain in `dependencies`
- `dist/cli.js` exists and is importable

### test-install.ts flow (artifact install verification)

Uses Docker for clean, reproducible target environments. The host builds the tarball,
then a container installs it from scratch with the real build toolchain and smokes the CLI.

```text
Host:
  1. npm pack (produce .tgz)

Container (node:24-bookworm-slim with build-essential + python3):
  2. Copy .tgz into container
  3. npm i -g ./open-design-daemon-*.tgz
  4. Verify od binary on PATH
  5. Run: od --version
  6. Run: od --help
  7. Run: od daemon start --no-open --port <random>  (verify daemon boots)
  8. Run: od daemon status --json --daemon-url <url>  (verify API responds)
  9. Run: od mcp install --print codex               (verify MCP install logic)
  10. Run: od doctor --json                           (verify health check)
  11. Kill daemon, remove container
```

### Docker test image

`apps/daemon/scripts/Dockerfile.test`:

```dockerfile
FROM node:24-bookworm-slim

# Native build toolchain (required by better-sqlite3, node-pty)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Smoke tools
RUN npm i -g npm@latest

WORKDIR /test
```

### test-install.ts script

```text
1. Build Docker image from Dockerfile.test
2. npm pack (produce .tgz in apps/daemon/)
3. docker run --rm -v <tgz>:/test/pkg.tgz <image> bash -c '
     npm i -g /test/pkg.tgz &&
     od --version &&
     od --help &&
     od daemon start --no-open --port 17456 &
     sleep 5 &&
     od daemon status --json --daemon-url http://127.0.0.1:17456 &&
     od mcp install --print codex &&
     od doctor --json &&
     kill %1
   '
4. Check exit code, capture output
```

### Multi-platform matrix (optional, for release confidence)

```text
docker build --platform linux/amd64 ...  (CI default)
docker build --platform linux/arm64 ...  (if arm64 runner available)
```

Windows and macOS verification remain manual (no Docker for those platforms).

## Source changes

### apps/daemon/package.json

```jsonc
{
  // Remove "private": true
  // Add:
  "engines": { "node": "~24" },
  "publishConfig": { "access": "public" },
  "files": [
    "bin",
    "dist",
    "resources",
    "package.json",
    "README.md"
  ],
  "scripts": {
    // Keep existing build/test/typecheck
    // Add:
    "build:publish": "tsx scripts/build-for-publish.ts",
    "validate:publish": "tsx scripts/validate-package.ts",
    "test:install": "tsx scripts/test-install.ts"
  }
}
```

### apps/daemon/bin/od.mjs

```js
#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const entryDir = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(entryDir, "../dist/cli.js");

if (!existsSync(distEntry)) {
  throw new Error(
    "Open Design daemon is not built. Reinstall the package or run 'od doctor'."
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
```

### apps/daemon/src/server.ts

Add `web/` as a resource segment for `STATIC_DIR`:

```ts
// Current (line ~620):
const STATIC_DIR = path.join(PROJECT_ROOT, 'apps', 'web', 'out');

// New:
const STATIC_DIR = DAEMON_RESOURCE_ROOT
  ? path.join(DAEMON_RESOURCE_ROOT, 'web')
  : path.join(PROJECT_ROOT, 'apps', 'web', 'out');
```

### apps/daemon/src/daemon-paths.ts

No changes needed. `resolveDaemonResourceDir(resourceRoot, segment, fallback)` already handles the pattern. We just add `web` as a new segment in `server.ts`.

### apps/daemon/scripts/bundle-workspace.ts (new)

esbuild config that bundles all 9 `workspace:*` dependencies into `dist/`:

```ts
// Bundle each workspace dep as a single ESM file
// External: native deps (better-sqlite3, node-pty), node builtins
// Entry: each workspace package's main export
// Output: dist/vendor/<package>.js
```

The daemon's compiled `dist/` already imports from workspace packages by name. After bundling, we either:
- Replace imports with relative paths to `dist/vendor/`, OR
- Bundle everything into a single `dist/bundle.js` that wraps the daemon

Desktop's mac-prebundle approach bundles workspace deps as separate files and keeps the daemon's imports pointing at them. We'll follow that pattern.

### apps/daemon/scripts/copy-resources.ts (new)

Copies all 10 resource trees from workspace paths to `resources/`. Also runs web build and copies `apps/web/out/` to `resources/web/`.

### apps/daemon/README.md (new or update)

Package-level README documenting:
- What this package is (Open Design daemon + CLI)
- Install: `npm i -g @open-design/daemon`
- Prerequisites: Node ~24, C++ build toolchain
- Quick start: `od` (starts daemon + opens web UI)
- Key commands: `od --help`, `od daemon start`, `od mcp install <agent>`
- Platform notes: Windows needs VS Build Tools, Linux needs build-essential, macOS needs Xcode CLT
- Troubleshooting: native build failures, daemon port conflicts

## Verification strategy

### Local (before commit)

```bash
pnpm --filter @open-design/daemon typecheck
pnpm --filter @open-design/daemon test
pnpm --filter @open-design/daemon build:publish
pnpm --filter @open-design/daemon validate:publish
pnpm --filter @open-design/daemon test:install
pnpm guard
pnpm typecheck
```

### CI (in PR)

Add a job to `ci.yml` (or a focused workflow) that:
1. Runs `build:publish` (host: build daemon, web, resources, produce .tgz)
2. Runs `validate:publish` (host: check package contents)
3. Runs `test:install` (Docker: install .tgz in clean `node:24-bookworm-slim` with build toolchain, smoke `od` commands)
4. Uploads the `.tgz` as a CI artifact for manual inspection

### Cross-platform smoke

Docker covers Linux x64 clean-install verification in CI. For full confidence, manually verify on:
- macOS (arm64 + x64) — `npm i -g` with Xcode CLT installed
- Windows (x64) — `npm i -g` with VS Build Tools 2022+ installed
- Linux (x64, bare metal) — `npm i -g` with build-essential installed

## What we do NOT touch

- Existing GitHub release workflows (`release-stable.yml`, `release-beta.yml`, etc.)
- `tools/pack/` — desktop packaging is separate
- `tools/release/` — release pipeline is separate
- `apps/packaged/` — desktop runtime is separate
- Root `package.json` `private: true` — stays private; only daemon package goes public
- npm registry publication automation — we only make the package publishable; actual `npm publish` is manual or a follow-up workflow

## Files changed/created

| File | Action | Purpose |
| --- | --- | --- |
| `apps/daemon/package.json` | Edit | Remove private, add engines/files/publishConfig/scripts |
| `apps/daemon/bin/od.mjs` | Edit | Set OD_RESOURCE_ROOT, fix error message |
| `apps/daemon/src/server.ts` | Edit | STATIC_DIR from resource root |
| `apps/daemon/scripts/build-for-publish.ts` | New | Build orchestrator |
| `apps/daemon/scripts/bundle-workspace.ts` | New | esbuild workspace dep bundler |
| `apps/daemon/scripts/copy-resources.ts` | New | Resource tree + web app copier |
| `apps/daemon/scripts/validate-package.ts` | New | Pre-publish validation |
| `apps/daemon/scripts/test-install.ts` | New | Artifact install smoke test |
| `apps/daemon/scripts/lib/paths.ts` | New | Shared path helpers |
| `apps/daemon/README.md` | New | Package-level install docs |
| `docs/publish-and-packaging/npm-cli-plan.md` | New | This design doc |

## Open questions

1. **esbuild bundle strategy**: bundle each workspace dep separately (matching desktop prebundle) or single monolithic bundle? Separate is safer for import resolution.
2. **`node-pty` spawn-helper chmod**: desktop daemon has special handling for this. We need the same in the npm package's postinstall or in `bin/od.mjs`.
3. **`data/plugin-previews/`**: is this directory generated or checked in? If generated, we need to bake it during build.
4. **npm package name**: `@open-design/daemon` or `@open-design/cli` or `open-design`? `@open-design/daemon` matches the existing package name.

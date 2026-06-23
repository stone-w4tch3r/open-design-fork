# Publish & Packaging Research

> Saved 2026-06-23. Covers current install/distribution setup, upstream signals, and
> actionable constraints for two PRs: npm CLI distribution and proper AppImage release.

## 1. Current release reality

Latest stable release `open-design-v0.11.0` (2026-06-17) ships:

- `open-design-0.11.0-mac-arm64.dmg`
- `open-design-0.11.0-mac-x64.dmg`
- `open-design-0.11.0-win-x64-setup.exe`
- `open-design-0.11.0-win-x64-portable.zip`
- `latest-mac.yml`, `latest.yml`

**No Linux AppImage in any stable release.** Linux AppImage is built by
`tools-pack linux build --to appimage` but gated off in release workflows.

## 2. CLI / npm distribution status

### What exists

- Root `package.json` has `"bin": { "od": "./apps/daemon/bin/od.mjs" }` but is `"private": true`.
- `apps/daemon/package.json` has `"bin": { "od": "./bin/od.mjs" }` but is `"private": true`.
- `od.mjs` requires built `apps/daemon/dist/cli.js` to exist.
- CLI is fully functional: `SUBCOMMAND_MAP` in `apps/daemon/src/cli.ts` covers
  MCP, plugin, automation, diagnostics, media, project, research, etc.
- `od mcp install <agent>` is the shipped agent-install command (PR #4649 merged).

### What does NOT exist

- No public npm package for `od` or `@open-design/cli`.
- PR #4649 body explicitly states: standalone `od` CLI / `npx od` is roadmap,
  daemon package is private.
- `docs/plugins-spec.md` references `npm install -g @open-design/cli` but that
  package does not exist locally or on npm.

### Key constraints for npm CLI PR

- Root and daemon packages are `private: true`.
- Daemon depends on many `workspace:*` internal packages (contracts, platform,
  sidecar, sidecar-proto, plugin-runtime, release, registry-protocol, etc.).
- Native deps: `better-sqlite3`, `node-pty`, `sharp`, etc. — need Node 24.
- Daemon needs web assets, skills, design systems, templates, frames at runtime.
- Daemon needs `OD_RESOURCE_ROOT` or equivalent to find bundled resources.
- Long-running daemon + web processes; global npm prefix paths are not designed
  for app-specific data/log/runtime/cache roots.

### npm CLI design direction (from research)

A thin bootstrapper/installer package is safer than publishing the full daemon:

```text
npm package (e.g. @open-design/cli or od)
└─ thin bootstrapper/installer
   ├─ detects platform
   ├─ downloads verified release/headless artifact
   ├─ manages local install/update
   └─ exposes od shim on PATH
```

This keeps npm as a bootstrap channel, not the runtime filesystem for
daemon/web/native assets.

## 3. AppImage / Linux desktop status

### What exists

- `tools-pack linux build --to appimage` — builds AppImage locally.
- `tools-pack linux build --containerized` — Docker-based build for wider glibc
  compat (targets `electronuserland/builder:base`, Ubuntu 18.04 / glibc 2.27).
- `tools-pack linux install` — installs AppImage to `~/.local/bin/` with XDG
  desktop entry and icon.
- `tools-pack linux start` — launches AppImage with `--appimage-extract-and-run`
  (FUSE bypass, needed because FUSE-mounted AppImage makes Node module loads too
  slow for daemon sidecar startup timeout).
- `tools-pack linux install --headless` / `start --headless` — headless
  (no-Electron) daemon+web mode.
- `tools-pack linux inspect` — desktop status, eval, screenshot for AppImage mode.
- `tools-pack linux logs` / `stop` / `uninstall` / `cleanup`.

### What is gated / missing

- **Stable release:** Linux job exists in `release-stable.yml` but gated by
  `vars.ENABLE_STABLE_LINUX == 'true'` (currently false). Comment says
  "containerized pnpm bootstrap is fixed and reviewed" is the blocker.
- **Beta release:** Linux input `enable_linux_x64` defaults to `false` in
  `release-beta.yml`.
- **AppImage signing:** deferred, no GPG key infrastructure.
- **AppImage auto-update feed:** `latest-linux.yml` not wired; electron-builder
  has no `publish` block for Linux.
- **Other formats:** `.deb`, `.rpm`, Snap, Flatpak deferred. Flatpak draft PR
  #2736 exists but is not merged.

### AppImage technical notes

- `--appimage-extract-and-run` is mandatory for acceptable daemon startup
  (FUSE-mounted AppImage makes Node module loads too slow — daemon sidecar
  fails 35s timeout). Document this for end users.
- `libfuse2` needed for direct FUSE launch; extract-and-run bypasses it.
- Electron 41 requires `kernel.unprivileged_userns_clone=1` (default on modern
  distros) or `--no-sandbox` fallback.
- Containerized builds target glibc 2.27 for broad distro compat.
- XDG install paths: `~/.local/bin/Open-Design.<namespace>.AppImage`,
  `~/.local/share/applications/open-design-<namespace>.desktop`,
  `~/.local/share/icons/hicolor/512x512/apps/open-design-<namespace>.png`.
- Namespace suffix is unconditional for dev multi-instance coexistence.

## 4. Upstream maintainer signals

### Linux desktop / AppImage

| Ref | Signal |
| --- | ------ |
| #3759 | Active Linux app request. Maintainer: AppImage/Flatpak as concrete first step is useful. Issue is with product for direction (`needs-product-direction` label). |
| #4368 | User reports README says Linux/AppImage but releases have no Linux asset. Maintainer agrees wording is confusing. Sequencing: product direction on #3759 → Flatpak PR #2736 → updater work later. |
| #2736 | Draft Flatpak PR. Builds and runs but daemon-to-opencode connection times out. Author suggests only Flatpak metadata belongs upstream. |
| #1788 | Draft Linux release-readiness plan. Linux should not be considered shipped until beta artifacts, distro smoke, stable gating, and public install copy are evidenced. |
| #709 | Original Linux tracking issue, closed when smoke-test infra merged (#1204). |
| #369 | Added `tools-pack linux` lane and AppImage release wiring (merged). |
| #567 | Deferred Linux from 0.4.0 stable (merged). |
| #1204 | Added Linux headless/AppImage lifecycle coverage and release smoke evidence (merged). |
| #2276, #2845 | Linux AppImage build fixes (merged). #2845 fixed missing workspace packages in AppImage assembly. |

### CLI / npm / install

| Ref | Signal |
| --- | ------ |
| #4649 | Merged docs fix. Explicitly: hosted `install.sh` was never published; standalone `od` CLI / `npx od` is roadmap; daemon package is private. |
| #4662 | Onboarding CLI empty state lacks install guidance. Maintainer invites community pickup. |
| #4489 | `install.sh` serves HTML (real bug). Source `tools-dev run web` CORS/403 open. |
| #4648 | `od` binary ambiguity on Windows/WSL MCP setup. |

### Headless / WebUI

| Ref | Signal |
| --- | ------ |
| #3508 | Cross-platform WebUI packaging proposal. Maintainer: direction makes sense, bias toward opt-in packaging target first. |
| #3509 | Open PR implementing `tools-pack webui build`. Code review clean, blocked on product review/QA. |

### Windows installer / signing

| Ref | Signal |
| --- | ------ |
| #4034 | Setup.exe installer regression (app still running). Workaround: use portable zip. |
| #1084 | SmartScreen warning removal. Maintainer: signing is valid, Azure Artifact Signing viable, but identity/billing/CI decisions remain. |
| #4554 | Docs explaining SmartScreen warning and SHA-256 verification (merged). |

### Nix

| Ref | Signal |
| --- | ------ |
| #402 | Official flake with Home Manager and NixOS support (merged). |
| #2919 | Optimize Nix maintenance and contributor UX (merged). |
| #3990 | Fix Nix pnpm_10 pin (merged). |

## 5. Repo conventions that constrain both PRs

- Root lifecycle is `pnpm tools-dev` only; no root `pnpm dev/start/build/test`.
- Packaged runtime paths must be namespace-scoped and independent of ports.
- Release identities must stay channel-distinct (stable: `Open Design`, beta:
  `Open Design Beta`, prerelease: `Open Design Prerelease`, preview: `Open Design Preview`).
- Daemon data paths must derive from `RUNTIME_DATA_DIR` (root AGENTS.md
  "Daemon data directory contract").
- `packages/contracts` must stay pure TypeScript, free of Node/Express/SQLite/fs
  deps.
- CLI and web must both expose every user-facing capability; CLI must support
  `--json` and `--prompt-file`.
- App packages must not import another app's private `src/`.
- Tests live in `tests/` sibling to `src/`, not under `src/`.

## 6. Key files to touch

### For npm CLI PR

- `apps/daemon/package.json` — make public, adjust `files`, add publish config
- `apps/daemon/bin/od.mjs` — may need resource-root resolution changes
- `apps/daemon/src/cli.ts` — may need bundled-resource path logic
- `package.json` (root) — may need workspace publish config
- Internal `workspace:*` deps — need publish strategy (bundle vs publish individually)
- `docs/plugins-spec.md` — fix stale `@open-design/cli` references
- New: `docs/publish-and-packaging/npm-cli-plan.md` — design doc

### For AppImage PR

- `.github/workflows/release-stable.yml` — enable Linux job or document gating
- `.github/workflows/release-beta.yml` — enable Linux input or document gating
- `tools/pack/src/linux.ts` — may need artifact naming / checksum / feed wiring
- `tools/pack/README.md` — may need end-user install docs
- `README.md` — fix Linux/AppImage wording to match reality
- `docs/i18n/README.zh-CN.md` — fix Chinese README Linux wording
- New: `docs/publish-and-packaging/appimage-plan.md` — design doc

## 7. Verification strategy

### npm CLI

- `npm pack --dry-run` from daemon package to verify included files
- Install from local tarball: `npm i -g ./open-design-daemon-*.tgz`
- Verify `od --version`, `od mcp install --print`, `od --help`
- Verify resource resolution (skills, design systems, templates)
- Verify native deps work on target Node 24
- Cross-platform: macOS, Linux, Windows (WSL)

### AppImage

- `pnpm tools-pack linux build --containerized --to appimage --portable`
- `pnpm tools-pack linux install` (verify XDG paths)
- `pnpm tools-pack linux start` (verify daemon + web launch)
- `pnpm tools-pack linux inspect desktop status --json`
- `pnpm tools-pack linux inspect desktop screenshot`
- `pnpm tools-pack linux stop`
- `pnpm tools-pack linux uninstall`
- Verify `--appimage-extract-and-run` behavior
- Verify on at least Ubuntu 24.04 and one other distro

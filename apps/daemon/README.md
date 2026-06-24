# @open-design/daemon

Open Design local daemon and CLI. Start the daemon, open the web UI, or drive
design workflows headlessly through the `od-cli` command.

## Install

```bash
npm install -g @open-design/daemon
```

### Prerequisites

- **Node.js ~24** (the `engines` field enforces this)
- **C++ build toolchain** for native dependencies:
  - **Linux:** `build-essential` + `python3` (`sudo apt install build-essential python3`)
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** Visual Studio Build Tools 2022 or newer with "Desktop development with C++"

## Quick start

```bash
# Start the daemon and open the web UI
od-cli

# Headless mode (no browser)
od-cli --no-open

# Check daemon status
od-cli daemon status

# Install MCP server into your coding agent
od-cli mcp install claude

# List available commands
od-cli --help
```

## Troubleshooting

### Native build failures

If `npm install` fails with node-gyp errors, make sure your C++ toolchain is installed:

- **Linux:** `sudo apt install build-essential python3`
- **macOS:** `xcode-select --install`
- **Windows:** Install Visual Studio Build Tools 2022+ with "Desktop development with C++" workload

### Port conflicts

The daemon defaults to port 7456. Override with `--port` or `OD_PORT`:

```bash
od-cli --port 9000
OD_PORT=9000 od-cli
```

### Daemon not built

If you see "Open Design daemon is not built", reinstall the package:

```bash
npm uninstall -g @open-design/daemon
npm install -g @open-design/daemon
```

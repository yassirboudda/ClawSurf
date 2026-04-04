# ClawSurf 🦀🏄

A dedicated Chromium-based browser for [OpenClaw](https://openclaw.ai) automation. ClawSurf runs as a separate browser profile with built-in extensions pre-loaded, so your main browser stays untouched.

## Features

- **Isolated profile** — separate user data directory, won't interfere with your daily browser
- **OpenClaw Browser Relay extension** — auto-loaded on every page, maintains CDP (Chrome DevTools Protocol) connection for AI agent control
- **Always-on status indicator** — floating pill shows connection status (🟢 LISTENING / 🟡 CDP READY / 🔴 OFF)
- **Auto-attach** — relay re-attaches automatically on tab create, navigation, and page load
- **Title rewriting** — replaces "Chromium" with "ClawSurf" in window titles
- **Dock-friendly** — proper `StartupWMClass` and desktop entry so it shows as "ClawSurf" in your taskbar
- **TeachAnAgent** — built-in action recorder extension with play/pause/stop/export UI for capturing browser interactions as JSON
- **DevTools MCP Logger** — captures all browser activity (network, console, errors, DOM, performance) and exposes it to GitHub Copilot via MCP
- **Remote debugging enabled** — CDP port 18800 always active for automation

## Bundled Extensions

| Extension | Purpose |
|-----------|---------|
| **Browser Relay** | Bridges ClawSurf ↔ OpenClaw gateway via WebSocket relay + CDP forwarding |
| **TeachAnAgent** | Records browser interactions (clicks, inputs, navigation) as exportable JSON |
| **DevTools MCP Logger** | Captures browser debugging data and streams it to an MCP server for VS Code / GitHub Copilot |

## Requirements

- **Linux** with Chromium installed via snap (`/snap/bin/chromium`)
- **Node.js** 18+ (for MCP server)
- [OpenClaw](https://openclaw.ai) gateway running locally (default port `18789`) — optional, only for relay

## Install

```bash
git clone https://github.com/Airpote/ClawSurf.git
cd ClawSurf
chmod +x install.sh
./install.sh
```

The installer will:
1. Copy all three extensions to `~/snap/chromium/common/`
2. Install the MCP server to `~/.local/share/clawsurf/devtools-mcp-server/`
3. Configure VS Code MCP (`~/.config/Code/User/mcp.json`) if not already set
4. Install the `ClawSurf` launcher to `~/.local/bin/`
5. Create a desktop entry for your taskbar

## Usage

```bash
# Open ClawSurf
ClawSurf

# Open a specific URL
ClawSurf https://example.com
```

The browser connects to:
- **CDP** on `127.0.0.1:18800` (Chromium remote debugging)
- **OpenClaw Gateway** on `127.0.0.1:18789`
- **Relay WebSocket** on `127.0.0.1:18792`
- **MCP HTTP** on `127.0.0.1:9223` (DevTools MCP Logger → MCP server)

## Project Structure

```
ClawSurf/
├── extension/                 # Browser Relay (Chrome MV3)
│   ├── manifest.json
│   ├── background.js          # Service worker (relay, CDP forwarding)
│   ├── content-status.js      # In-page status pill + title rewriter
│   ├── options.html / .js     # Settings page
│   └── icons/
├── teachanagent/              # TeachAnAgent recorder (Chrome MV3)
│   ├── manifest.json
│   ├── background.js          # State machine + event aggregation
│   ├── content-recorder.js    # DOM event capture + visual indicator
│   ├── popup.html / .js       # Record/Pause/Stop/Export UI
│   └── icons/
├── devtools-mcp/              # DevTools MCP Logger (Chrome MV3)
│   ├── manifest.json
│   ├── background.js          # chrome.debugger API capture
│   ├── popup.html / .js / .css# Activate/Deactivate UI
│   ├── journal.html / .js / .css # Log viewer with filtering
│   └── icons/
├── devtools-mcp-server/       # MCP Server (Node.js)
│   ├── server.js              # stdio MCP + HTTP receiver on port 9223
│   ├── package.json
│   └── package-lock.json
├── launcher/
│   ├── clawsurf.sh            # Main launcher (loads all extensions)
│   ├── clawsurf-launch.sh     # Background launcher (for .desktop)
│   └── clawsurf.desktop       # Desktop entry template
├── install.sh                 # Installer
└── README.md
```

## DevTools MCP Logger — Browser Debugging for AI

The DevTools MCP Logger captures real-time browser activity and makes it available to GitHub Copilot (or any MCP client) as queryable context.

### Architecture

```
┌─────────────────┐     HTTP (localhost:9223)    ┌──────────────────┐     stdio     ┌───────────────┐
│  ClawSurf        │ ──────────────────────────▶  │  MCP Server      │ ◀──────────▶  │  VS Code /    │
│  Extension       │   POST /events               │  (Node.js)       │   MCP proto   │  GitHub Copilot│
│  (debugger API)  │   POST /meta                 │  In-memory store │               │               │
│                  │   DELETE on page close        │                  │               │               │
└─────────────────┘                               └──────────────────┘               └───────────────┘
```

### What It Captures
- **Network requests** — URLs, methods, status codes, headers, timing
- **Console output** — log, warn, error, info with stack traces
- **JavaScript errors & exceptions**
- **DOM mutations** — node insertions, removals, attribute changes
- **Performance metrics** — page load, DOMContentLoaded, etc.
- **Script sources** parsed by the browser

### MCP Tools (for GitHub Copilot)
- `get_active_sessions` — List all monitored tabs
- `get_all_logs` — Get all captured data
- `get_session_logs` — Get logs for specific tab with category filter
- `get_errors` — Get only errors/exceptions
- `get_network_requests` — Get network activity
- `get_console_output` — Get console messages
- `clear_session` / `clear_all_sessions` — Manual cleanup

### Usage
1. Navigate to any page in ClawSurf
2. Click the DevTools MCP Logger icon → **Activate**
3. Interact with the page — all activity is captured
4. In VS Code, open GitHub Copilot Chat and add context from the `chrome-devtools` MCP
5. Ask Copilot about errors, network issues, or page behavior
6. **Deactivate** or close the tab → session data is automatically cleared (no log pollution)

### VS Code MCP Configuration

The installer auto-configures `~/.config/Code/User/mcp.json`. Manual setup:

```json
{
  "servers": {
    "chrome-devtools": {
      "type": "stdio",
      "command": "node",
      "args": ["~/.local/share/clawsurf/devtools-mcp-server/server.js"],
      "env": { "MCP_HTTP_PORT": "9223" }
    }
  }
}
```

## TeachAnAgent — Browser Action Recorder

TeachAnAgent records your browser interactions so you can teach an AI agent by example.

### Captured Events
- **Clicks** — element tag, text, CSS selector, coordinates
- **Inputs** — typed values (passwords auto-masked), change events
- **Form submits** — form action and method
- **Scroll** — position snapshots (throttled to 500ms)
- **Keyboard shortcuts** — modifier combos + Enter/Tab/Escape
- **Navigation** — URL changes, SPA pushState/replaceState, hash changes
- **Page lifecycle** — load, unload, beforeunload

### Usage
1. Click the TeachAnAgent extension icon in the toolbar
2. Press **⏺ Record** to start capturing
3. Interact with the page normally
4. Use **⏸ Pause** / **▶ Resume** as needed
5. Press **⏹ Stop** to end the session
6. Click **⬇ Export JSON** to download the recorded events

Starting a new recording clears the previous session. A visual indicator (🔴 / ⏸️) appears at the top of the page during recording.

## How It Works

1. `ClawSurf` launches Chromium with `--remote-debugging-port=18800` and a dedicated user profile
2. All three extensions load automatically:
   - **Browser Relay** connects to OpenClaw's relay WebSocket
   - **TeachAnAgent** stands by for recording
   - **DevTools MCP Logger** waits for activation per tab
3. OpenClaw's AI agent can navigate, snapshot, click, and interact with any page through CDP commands forwarded via the relay
4. The status pill on every page shows the relay connection state in real-time
5. When DevTools MCP Logger is activated, all browser events flow to VS Code / GitHub Copilot as MCP resources

## Configuration

Open the Browser Relay extension options page (click extension icon → "Options") to configure:
- **Relay port** — default `18792`
- **Auto-attach** — enabled by default

## License

MIT

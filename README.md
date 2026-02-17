# ClawSurf 🦀🏄

A dedicated Chromium-based browser for [OpenClaw](https://openclaw.ai) automation. ClawSurf runs as a separate browser profile with the **OpenClaw Browser Relay** extension pre-loaded, so your main browser stays untouched.

## Features

- **Isolated profile** — separate user data directory, won't interfere with your daily browser
- **OpenClaw Browser Relay extension** — auto-loaded on every page, maintains CDP (Chrome DevTools Protocol) connection for AI agent control
- **Always-on status indicator** — floating pill shows connection status (🟢 LISTENING / 🟡 CDP READY / 🔴 OFF)
- **Auto-attach** — relay re-attaches automatically on tab create, navigation, and page load
- **Title rewriting** — replaces "Chromium" with "ClawSurf" in window titles
- **Dock-friendly** — proper `StartupWMClass` and desktop entry so it shows as "ClawSurf" in your taskbar
- **TeachAnAgent** — built-in action recorder extension with play/pause/stop/export UI for capturing browser interactions as JSON
- **TeachAnAgent** — built-in action recorder extension with play/pause/stop/export UI for capturing browser interactions as JSON

## Requirements

- **Linux** with Chromium installed via snap (`/snap/bin/chromium`)
- [OpenClaw](https://openclaw.ai) gateway running locally (default port `18789`)

## Install

```bash
git clone https://github.com/Airpote/ClawSurf.git
cd ClawSurf
chmod +x install.sh
./install.sh
```

## Usage

```bash
# Open ClawSurf
ClawSurf

# Open a specific URL
ClawSurf https://example.com
```

The extension connects to:
- **CDP** on `127.0.0.1:18800` (Chromium remote debugging)
- **OpenClaw Gateway** on `127.0.0.1:18789`
- **Relay WebSocket** on `127.0.0.1:18792`

## Project Structure

```
ClawSurf/
├── extension/              # Browser Relay (Chrome MV3)
│   ├── manifest.json
│   ├── background.js       # Service worker (relay, CDP forwarding)
│   ├── content-status.js   # In-page status pill + title rewriter
│   ├── options.html / .js  # Settings page
│   └── icons/
├── teachanagent/           # TeachAnAgent recorder (Chrome MV3)
│   ├── manifest.json
│   ├── background.js       # State machine + event aggregation
│   ├── content-recorder.js # DOM event capture + visual indicator
│   ├── popup.html / .js    # Record/Pause/Stop/Export UI
│   └── icons/
├── launcher/
│   ├── clawsurf.sh         # Main launcher (loads both extensions)
│   ├── clawsurf-launch.sh  # Background launcher (for .desktop)
│   └── clawsurf.desktop    # Desktop entry template
├── install.sh              # Installer
└── README.md
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
2. Both extensions load automatically — **Browser Relay** connects to OpenClaw's relay WebSocket, **TeachAnAgent** stands by for recording
3. OpenClaw's AI agent can navigate, snapshot, click, and interact with any page through CDP commands forwarded via the relay
4. The status pill on every page shows the relay connection state in real-time

## Configuration

Open the extension options page (click extension icon → "Options") to configure:
- **Relay port** — default `18792`
- **Auto-attach** — enabled by default

## License

MIT

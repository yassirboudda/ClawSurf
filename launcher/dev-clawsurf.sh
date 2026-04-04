#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PROFILE_DIR="$HOME/snap/chromium/common/ami-browser-profile"
EXT_RELAY="$REPO_DIR/extension"
EXT_TEACH="$REPO_DIR/teachanagent"
EXT_DEVTOOLS_MCP="$REPO_DIR/devtools-mcp"
EXT_HUB="$REPO_DIR/clawsurf-hub"
EXT_ADBLOCK="$REPO_DIR/ami-adblocker"
EXT_WALLET="$REPO_DIR/ami-wallet"
EXT_REWARDS="$REPO_DIR/ami-rewards"
URL="${1:-chrome://newtab}"
PORTS=(18789 18792 18800 9223)

mkdir -p "$PROFILE_DIR"

# ── Force fresh start: clear saved session so browser opens new tab ──
rm -f "$PROFILE_DIR/Default/Sessions/Session_"* "$PROFILE_DIR/Default/Sessions/Tabs_"* 2>/dev/null || true

# ── Set preference: open New Tab page on startup (hub extension overrides NTP) ──
PREFS_FILE="$PROFILE_DIR/Default/Preferences"
if [[ -f "$PREFS_FILE" ]]; then
  python3 -c "
import json, sys
try:
    with open(sys.argv[1], 'r') as f:
        p = json.load(f)
    p.setdefault('session', {})['restore_on_startup'] = 5
    p['session'].pop('startup_urls', None)
    p.setdefault('browser', {})['has_seen_welcome_page'] = True
    p.setdefault('distribution', {})['suppress_first_run_bubble'] = True
    with open(sys.argv[1], 'w') as f:
        json.dump(p, f)
except Exception:
    pass
" "$PREFS_FILE" 2>/dev/null || true
fi

ARGS=(
  --user-data-dir="$PROFILE_DIR"
  --remote-debugging-port=18800
  --no-first-run
  --no-default-browser-check
  --class=AMI-Browser
  --user-agent="AMI Browser/2.0"
  --ozone-platform=x11
  --disable-features=ExtensionServiceWorkerLifetimeV2
  --disable-background-timer-throttling
  --disable-renderer-backgrounding
  --disable-backgrounding-occluded-windows
)

# Collect extensions to load
EXT_LIST=""
for ext in "$EXT_RELAY" "$EXT_TEACH" "$EXT_DEVTOOLS_MCP" "$EXT_HUB" "$EXT_ADBLOCK" "$EXT_WALLET" "$EXT_REWARDS"; do
  if [[ -d "$ext" ]]; then
    if [[ -n "$EXT_LIST" ]]; then
      EXT_LIST="$EXT_LIST,$ext"
    else
      EXT_LIST="$ext"
    fi
  fi
done

if [[ -n "$EXT_LIST" ]]; then
  ARGS+=(
    --disable-extensions-except="$EXT_LIST"
    --load-extension="$EXT_LIST"
  )
fi

export BAMF_DESKTOP_FILE_HINT="$HOME/.local/share/applications/ami-browser.desktop"
export DESKTOP_FILE_NAME="ami-browser"

FIREWALL_ACTIVE=0
setup_firewall() {
  if ! command -v sudo >/dev/null 2>&1; then
    return
  fi
  for port in "${PORTS[@]}"; do
    sudo -n iptables -C INPUT -p tcp --dport "$port" ! -i lo -j DROP -m comment --comment "ami-browser-guard" 2>/dev/null || \
      sudo -n iptables -A INPUT -p tcp --dport "$port" ! -i lo -j DROP -m comment --comment "ami-browser-guard" 2>/dev/null || true
  done
  FIREWALL_ACTIVE=1
}

teardown_firewall() {
  if [[ "$FIREWALL_ACTIVE" -ne 1 ]]; then
    return
  fi
  for port in "${PORTS[@]}"; do
    sudo -n iptables -D INPUT -p tcp --dport "$port" ! -i lo -j DROP -m comment --comment "ami-browser-guard" 2>/dev/null || true
  done
}

setup_firewall

GATEWAY_PID=""
if [[ -f "$REPO_DIR/clawsurf-hub/gateway.js" ]]; then
  setsid node "$REPO_DIR/clawsurf-hub/gateway.js" >/tmp/ami-browser-gateway.log 2>&1 &
  GATEWAY_PID=$!
  echo "[AMI Browser] Gateway started (PID $GATEWAY_PID)"
fi

TITLE_PID=""
start_title_override() {
  # Continuously strip "Chromium" from all AMI Browser window titles.
  # Catches: "- Chromium", "Customize Chromium", any other occurrence.
  if command -v xdotool >/dev/null 2>&1 && command -v xprop >/dev/null 2>&1; then
    (
      set +e  # xdotool returns exit 1 when no windows found
      while true; do
        sleep 0.3
        for wid in $(xdotool search --class "AMI-Browser" 2>/dev/null); do
          cur=$(xprop -id "$wid" _NET_WM_NAME 2>/dev/null | sed 's/^[^"]*"//;s/"$//') || continue
          case "$cur" in
            *"Chromium"*)
              clean="${cur// - Chromium/}"
              clean="${clean//Customize Chromium/Customize AMI Browser}"
              clean="${clean//Chromium/AMI Browser}"
              [[ -z "$clean" ]] && clean="AMI Browser"
              xdotool set_window --name "$clean" "$wid" 2>/dev/null || true
              ;;
          esac
        done
      done
    ) &
    TITLE_PID=$!
  fi
}

start_title_override

# ── Close any auto-opened options.html tab via CDP ──
close_options_tabs() {
  # Wait for CDP endpoint to become available
  for i in $(seq 1 20); do
    if curl -s http://127.0.0.1:18800/json/list >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
  # Find and close any options.html tabs
  python3 -c "
import json, urllib.request, sys
try:
    data = urllib.request.urlopen('http://127.0.0.1:18800/json/list', timeout=3).read()
    tabs = json.loads(data)
    for t in tabs:
        url = t.get('url', '')
        if '/options.html' in url and 'chrome-extension://' in url:
            tid = t['id']
            urllib.request.urlopen(f'http://127.0.0.1:18800/json/close/{tid}', timeout=3)
            print(f'[AMI Browser] Closed options tab {tid}')
except Exception as e:
    pass
" 2>/dev/null || true
}

OPTIONS_CLOSER_PID=""

cleanup() {
  if [[ -n "$TITLE_PID" ]]; then
    kill "$TITLE_PID" 2>/dev/null || true
  fi
  if [[ -n "$OPTIONS_CLOSER_PID" ]]; then
    kill "$OPTIONS_CLOSER_PID" 2>/dev/null || true
  fi
  if [[ -n "$GATEWAY_PID" ]]; then
    echo "[AMI Browser] Stopping gateway (PID $GATEWAY_PID)"
    kill -- -"$GATEWAY_PID" 2>/dev/null || kill "$GATEWAY_PID" 2>/dev/null || true
    sleep 1
    kill -9 -- -"$GATEWAY_PID" 2>/dev/null || kill -9 "$GATEWAY_PID" 2>/dev/null || true
  fi
  teardown_firewall
}
trap cleanup EXIT

/snap/bin/chromium "${ARGS[@]}" "$URL" &
BROWSER_PID=$!

# Close options tab in background so it doesn't block
close_options_tabs &
OPTIONS_CLOSER_PID=$!

wait "$BROWSER_PID"
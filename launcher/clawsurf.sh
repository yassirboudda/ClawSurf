#!/usr/bin/env bash
set -euo pipefail

PROFILE_DIR="$HOME/snap/chromium/common/ami-browser-profile"
EXT_RELAY="$HOME/snap/chromium/common/clawsurf-relay-extension"
EXT_TEACH="$HOME/snap/chromium/common/clawsurf-teachanagent"
EXT_DEVTOOLS_MCP="$HOME/snap/chromium/common/clawsurf-devtools-mcp"
EXT_HUB="$HOME/snap/chromium/common/clawsurf-hub-extension"
EXT_ADBLOCK="$HOME/snap/chromium/common/ami-adblocker-extension"
EXT_WALLET="$HOME/snap/chromium/common/ami-wallet-extension"
EXT_REWARDS="$HOME/snap/chromium/common/ami-rewards-extension"
URL="${1:-chrome://newtab}"

mkdir -p "$PROFILE_DIR"

ARGS=(
  --user-data-dir="$PROFILE_DIR"
  --remote-debugging-port=18800
  --no-first-run
  --no-default-browser-check
  --class=AMI-Browser
  --app-name="AMI Browser"
  --user-agent="AMI Browser"
  --ozone-platform=x11
  # ── Keep MV3 service workers alive ──
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

TITLE_PID=""
start_title_override() {
  if command -v xdotool >/dev/null 2>&1 && command -v xprop >/dev/null 2>&1; then
    (
      set +e
      while true; do
        sleep 0.4
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

cleanup() {
  if [[ -n "$TITLE_PID" ]]; then
    kill "$TITLE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

/snap/bin/chromium "${ARGS[@]}" "$URL" &
CHROMIUM_PID=$!
wait "$CHROMIUM_PID"

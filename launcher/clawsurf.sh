#!/usr/bin/env bash
set -euo pipefail

PROFILE_DIR="$HOME/snap/chromium/common/clawsurf-profile"
EXT_RELAY="$HOME/snap/chromium/common/clawsurf-relay-extension"
EXT_TEACH="$HOME/snap/chromium/common/clawsurf-teachanagent"
URL="${1:-about:blank}"

mkdir -p "$PROFILE_DIR"

ARGS=(
  --user-data-dir="$PROFILE_DIR"
  --remote-debugging-port=18800
  --no-first-run
  --no-default-browser-check
  --class=ClawSurf
  --ozone-platform=x11
)

# Collect extensions to load
EXT_LIST=""
for ext in "$EXT_RELAY" "$EXT_TEACH"; do
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

export BAMF_DESKTOP_FILE_HINT="$HOME/.local/share/applications/clawsurf.desktop"
export DESKTOP_FILE_NAME="clawsurf"

exec /snap/bin/chromium "${ARGS[@]}" "$URL"

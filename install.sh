#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR"

EXT_RELAY_DEST="$HOME/snap/chromium/common/clawsurf-relay-extension"
EXT_TEACH_DEST="$HOME/snap/chromium/common/clawsurf-teachanagent"
BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local/share/applications"

echo "🦀 Installing ClawSurf..."

# 1. Browser Relay extension
echo "  → Copying Browser Relay extension to $EXT_RELAY_DEST"
mkdir -p "$EXT_RELAY_DEST"
cp -r "$REPO_DIR/extension/"* "$EXT_RELAY_DEST/"

# 2. TeachAnAgent extension
echo "  → Copying TeachAnAgent extension to $EXT_TEACH_DEST"
mkdir -p "$EXT_TEACH_DEST/icons"
cp -r "$REPO_DIR/teachanagent/"* "$EXT_TEACH_DEST/"

# 3. Launcher scripts
echo "  → Installing launcher scripts to $BIN_DIR"
mkdir -p "$BIN_DIR"
cp "$REPO_DIR/launcher/clawsurf.sh" "$BIN_DIR/ClawSurf"
cp "$REPO_DIR/launcher/clawsurf-launch.sh" "$BIN_DIR/ClawSurf-launch"
chmod +x "$BIN_DIR/ClawSurf" "$BIN_DIR/ClawSurf-launch"

# 4. Desktop entry
echo "  → Installing desktop entry"
mkdir -p "$APP_DIR"
sed "s|\\\$HOME|$HOME|g" "$REPO_DIR/launcher/clawsurf.desktop" > "$APP_DIR/clawsurf.desktop"

# 5. Update desktop database (optional)
if command -v update-desktop-database &>/dev/null; then
  update-desktop-database "$APP_DIR" 2>/dev/null || true
fi

echo ""
echo "✅ ClawSurf installed!"
echo ""
echo "   Launch:  ClawSurf"
echo "   Or:      ClawSurf https://example.com"
echo ""
echo "   Make sure ~/.local/bin is in your PATH."
echo "   Both extensions (Browser Relay + TeachAnAgent) will auto-load in ClawSurf."

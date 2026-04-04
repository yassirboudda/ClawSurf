#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR"

EXT_RELAY_DEST="$HOME/snap/chromium/common/clawsurf-relay-extension"
EXT_TEACH_DEST="$HOME/snap/chromium/common/clawsurf-teachanagent"
EXT_DEVTOOLS_MCP_DEST="$HOME/snap/chromium/common/clawsurf-devtools-mcp"
EXT_HUB_DEST="$HOME/snap/chromium/common/clawsurf-hub-extension"
EXT_ADBLOCK_DEST="$HOME/snap/chromium/common/ami-adblocker-extension"
EXT_WALLET_DEST="$HOME/snap/chromium/common/ami-wallet-extension"
EXT_REWARDS_DEST="$HOME/snap/chromium/common/ami-rewards-extension"
MCP_SERVER_DIR="$HOME/.local/share/clawsurf/devtools-mcp-server"
AMI_BROWSER_DIR="$HOME/.local/lib/ami-browser"
BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local/share/applications"

echo "🦀 Installing ClawSurf..."

# 0. AMI Browser binary (if tarball or extracted dir exists)
DIST_DIR="$REPO_DIR/build/dist/ami-browser-linux64"
if [[ -d "$DIST_DIR" ]]; then
  echo "  → Installing AMI Browser binary to $AMI_BROWSER_DIR"
  mkdir -p "$AMI_BROWSER_DIR"
  cp -r "$DIST_DIR/"* "$AMI_BROWSER_DIR/"
  chmod +x "$AMI_BROWSER_DIR/ami-browser"
  # chrome-sandbox needs root:root + SUID 4755 for the SUID sandbox
  if [[ -f "$AMI_BROWSER_DIR/chrome-sandbox" ]]; then
    sudo chown root:root "$AMI_BROWSER_DIR/chrome-sandbox" 2>/dev/null && \
    sudo chmod 4755 "$AMI_BROWSER_DIR/chrome-sandbox" 2>/dev/null || \
    echo "  ⚠ Could not set SUID on chrome-sandbox (needs sudo). Namespace sandbox will be used instead."
  fi
else
  echo "  ℹ No build/dist/ami-browser-linux64 found — skipping binary install"
fi

# 0b. AppArmor profile for Ubuntu 24.04+ (allows unprivileged user namespaces)
if [[ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]] && \
   [[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" == "1" ]]; then
  if [[ ! -f /etc/apparmor.d/ami-browser ]]; then
    echo "  → Creating AppArmor profile for AMI Browser (Ubuntu 24.04+ userns restriction)"
    APPARMOR_PROFILE='abi <abi/4.0>,
include <tunables/global>

profile ami-browser /home/*/.local/lib/ami-browser/ami-browser flags=(unconfined) {
  userns,
  include if exists <local/ami-browser>
}'
    if command -v pkexec &>/dev/null; then
      pkexec bash -c "echo '$APPARMOR_PROFILE' > /etc/apparmor.d/ami-browser && apparmor_parser -r /etc/apparmor.d/ami-browser" 2>/dev/null || \
      echo "  ⚠ Could not create AppArmor profile. Run: sudo tee /etc/apparmor.d/ami-browser and load with sudo apparmor_parser -r"
    else
      sudo bash -c "echo '$APPARMOR_PROFILE' > /etc/apparmor.d/ami-browser && apparmor_parser -r /etc/apparmor.d/ami-browser" 2>/dev/null || \
      echo "  ⚠ Could not create AppArmor profile (needs sudo/pkexec)."
    fi
  fi
fi

# 1. Browser Relay extension
echo "  → Copying Browser Relay extension to $EXT_RELAY_DEST"
mkdir -p "$EXT_RELAY_DEST"
cp -r "$REPO_DIR/extension/"* "$EXT_RELAY_DEST/"

# 2. TeachAnAgent extension
echo "  → Copying TeachAnAgent extension to $EXT_TEACH_DEST"
mkdir -p "$EXT_TEACH_DEST/icons"
cp -r "$REPO_DIR/teachanagent/"* "$EXT_TEACH_DEST/"

# 3. DevTools MCP Logger extension
echo "  → Copying DevTools MCP Logger extension to $EXT_DEVTOOLS_MCP_DEST"
mkdir -p "$EXT_DEVTOOLS_MCP_DEST"
cp -r "$REPO_DIR/devtools-mcp/"* "$EXT_DEVTOOLS_MCP_DEST/"

# 4. MCP Server (for VS Code / GitHub Copilot integration)
echo "  → Installing DevTools MCP Server to $MCP_SERVER_DIR"
mkdir -p "$MCP_SERVER_DIR"
cp "$REPO_DIR/devtools-mcp-server/server.js" "$MCP_SERVER_DIR/"
cp "$REPO_DIR/devtools-mcp-server/package.json" "$MCP_SERVER_DIR/"
cp "$REPO_DIR/devtools-mcp-server/package-lock.json" "$MCP_SERVER_DIR/"
(cd "$MCP_SERVER_DIR" && npm install --omit=dev 2>/dev/null) || echo "  ⚠ npm install failed — run 'cd $MCP_SERVER_DIR && npm install' manually"

# 5. AMI Hub extension
echo "  → Copying AMI Hub extension to $EXT_HUB_DEST"
mkdir -p "$EXT_HUB_DEST"
cp -r "$REPO_DIR/clawsurf-hub/"* "$EXT_HUB_DEST/"

# 6. AMI Shield extension
echo "  → Copying AMI Shield extension to $EXT_ADBLOCK_DEST"
mkdir -p "$EXT_ADBLOCK_DEST"
cp -r "$REPO_DIR/ami-adblocker/"* "$EXT_ADBLOCK_DEST/"

# 7. AMI Wallet extension
echo "  → Copying AMI Wallet extension to $EXT_WALLET_DEST"
mkdir -p "$EXT_WALLET_DEST"
cp -r "$REPO_DIR/ami-wallet/"* "$EXT_WALLET_DEST/"

# 8. AMI Rewards extension
echo "  → Copying AMI Rewards extension to $EXT_REWARDS_DEST"
mkdir -p "$EXT_REWARDS_DEST"
cp -r "$REPO_DIR/ami-rewards/"* "$EXT_REWARDS_DEST/"

# 8b. AMI Web Store extension
EXT_WEBSTORE_DEST="$HOME/snap/chromium/common/ami-webstore-extension"
echo "  → Copying AMI Web Store extension to $EXT_WEBSTORE_DEST"
mkdir -p "$EXT_WEBSTORE_DEST"
cp -r "$REPO_DIR/ami-webstore/"* "$EXT_WEBSTORE_DEST/"

# 9. Configure VS Code MCP (if not already set)
VSCODE_MCP="$HOME/.config/Code/User/mcp.json"
if [[ ! -f "$VSCODE_MCP" ]]; then
  echo "  → Configuring VS Code MCP server"
  mkdir -p "$(dirname "$VSCODE_MCP")"
  cat > "$VSCODE_MCP" <<MCPEOF
{
  "servers": {
    "chrome-devtools": {
      "type": "stdio",
      "command": "node",
      "args": ["$MCP_SERVER_DIR/server.js"],
      "env": {
        "MCP_HTTP_PORT": "9223"
      }
    }
  }
}
MCPEOF
else
  echo "  ℹ VS Code MCP config already exists at $VSCODE_MCP — skipping"
  echo "    Add chrome-devtools server manually if needed (see README)"
fi

# 10. Launcher scripts
echo "  → Installing launcher scripts to $BIN_DIR"
mkdir -p "$BIN_DIR"
cp "$REPO_DIR/launcher/clawsurf.sh" "$BIN_DIR/AMI-Browser"
cp "$REPO_DIR/launcher/clawsurf-launch.sh" "$BIN_DIR/AMI-Browser-launch"
chmod +x "$BIN_DIR/AMI-Browser" "$BIN_DIR/AMI-Browser-launch"

# Backward compatibility launch aliases
ln -sf "$BIN_DIR/AMI-Browser" "$BIN_DIR/ClawSurf"
ln -sf "$BIN_DIR/AMI-Browser-launch" "$BIN_DIR/ClawSurf-launch"

# 11. Install application icon
echo "  → Installing AMI Browser icon"
ICON_SRC="$REPO_DIR/amibrowser/ami-logo.png"
if [[ -f "$ICON_SRC" ]]; then
  ICON_DIR="$HOME/.local/share/icons/hicolor"
  for size in 16 32 48 128 256 512; do
    dest="$ICON_DIR/${size}x${size}/apps"
    mkdir -p "$dest"
    if command -v convert &>/dev/null; then
      convert "$ICON_SRC" -resize "${size}x${size}" "$dest/ami-browser.png"
    else
      cp "$ICON_SRC" "$dest/ami-browser.png"
    fi
  done
  # Also install the original as a fallback pixmap
  mkdir -p "$HOME/.local/share/pixmaps"
  cp "$ICON_SRC" "$HOME/.local/share/pixmaps/ami-browser.png"
  # Update icon cache
  if command -v gtk-update-icon-cache &>/dev/null; then
    gtk-update-icon-cache -f -t "$ICON_DIR" 2>/dev/null || true
  fi
fi

# 12. Desktop entry
echo "  → Installing desktop entry"
mkdir -p "$APP_DIR"
sed "s|\\\$HOME|$HOME|g" "$REPO_DIR/launcher/clawsurf.desktop" > "$APP_DIR/ami-browser.desktop"

# Clean up legacy desktop entries
rm -f "$APP_DIR/clawsurf.desktop" "$APP_DIR/clawsurf-dev.desktop" \
      "$APP_DIR/clawsurf2.desktop" "$APP_DIR/ami-browser-dev.desktop"

# 13. Update desktop database (optional)
if command -v update-desktop-database &>/dev/null; then
  update-desktop-database "$APP_DIR" 2>/dev/null || true
fi

echo ""
echo "✅ ClawSurf installed!"
echo ""
echo "   Launch:  AMI-Browser"
echo "   Or:      AMI-Browser https://example.com"
echo ""
echo "   Make sure ~/.local/bin is in your PATH."
echo "   Extensions auto-loaded: Browser Relay, TeachAnAgent, DevTools MCP Logger, AMI Hub, AMI Shield, AMI Wallet, AMI Rewards"
echo ""
echo "   DevTools MCP Logger:"
echo "     • Click the extension icon in ClawSurf → 'Activate' to start capturing"
echo "     • Data flows to VS Code via MCP (GitHub Copilot can query it)"
echo "     • Deactivate or close the tab → session data is auto-cleared"

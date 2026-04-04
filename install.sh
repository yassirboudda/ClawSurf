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

# 11. Desktop entry
echo "  → Installing desktop entry"
mkdir -p "$APP_DIR"
sed "s|\\$HOME|$HOME|g" "$REPO_DIR/launcher/clawsurf.desktop" > "$APP_DIR/ami-browser.desktop"

# Backward compatibility desktop alias
cp "$APP_DIR/ami-browser.desktop" "$APP_DIR/clawsurf.desktop"

# 12. Update desktop database (optional)
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

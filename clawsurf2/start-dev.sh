#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Install deps if needed
if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  echo "[dev] Installing dependencies…"
  (cd "$SCRIPT_DIR" && npm install)
fi

# Also ensure MCP server deps are installed
MCP_DIR="$SCRIPT_DIR/../devtools-mcp-server"
if [[ -d "$MCP_DIR" && ! -d "$MCP_DIR/node_modules" ]]; then
  echo "[dev] Installing MCP server dependencies…"
  (cd "$MCP_DIR" && npm install)
fi

echo "[dev] Starting ClawSurf 2.0…"
cd "$SCRIPT_DIR"
exec npx electron . --dev "$@"

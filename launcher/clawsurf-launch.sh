#!/usr/bin/env bash
set -euo pipefail
URL="${1:-chrome://newtab}"
nohup "$HOME/.local/bin/AMI-Browser" "$URL" >/tmp/ami-browser.log 2>&1 &
exit 0

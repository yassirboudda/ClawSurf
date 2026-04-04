#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  AMI Browser — Custom Chromium Build Script
#  Full rebrand: zero traces of "Chromium" — like Edge does it.
#  Target: Chromium 146.0.7680.80 → AMI Browser 2.0
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

PRODUCT_NAME="AMI Browser"
PRODUCT_SHORT="ami-browser"
CHROMIUM_TAG="146.0.7680.80"
BUILD_DIR="/root/chromium-build"
NPROC=$(nproc)

log() { echo ""; echo "══ [$(date '+%H:%M:%S')] $1 ══"; }

log "AMI Browser Custom Build — Tag $CHROMIUM_TAG — $NPROC cores"

# ── 1. Install dependencies ──
log "Step 1/8: Installing build dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  git curl wget python3 python3-pip lsb-release sudo \
  build-essential clang lld ninja-build \
  pkg-config libglib2.0-dev libgtk-3-dev libnss3-dev \
  libatk1.0-dev libatk-bridge2.0-dev libcups2-dev \
  libxcomposite-dev libxdamage-dev libxrandr-dev \
  libgbm-dev libpango1.0-dev libasound2-dev \
  libpulse-dev libdbus-1-dev libxss-dev mesa-common-dev \
  libdrm-dev libxkbcommon-dev libatspi2.0-dev \
  uuid-dev default-jdk-headless libffi-dev \
  screen tmux xz-utils bzip2 zip unzip \
  libx11-xcb-dev libxcb-dri3-dev 2>/dev/null || true

# ── 2. Get depot_tools ──
log "Step 2/8: Setting up depot_tools"
if [[ ! -d "/root/depot_tools" ]]; then
  git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git /root/depot_tools
fi
export PATH="/root/depot_tools:$PATH"

# ── 3. Fetch Chromium source ──
log "Step 3/8: Fetching Chromium source"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

if [[ ! -f ".gclient" ]]; then
  cat > .gclient <<'GCLIENT'
solutions = [
  {
    "name": "src",
    "url": "https://chromium.googlesource.com/chromium/src.git",
    "managed": False,
    "custom_deps": {},
    "custom_vars": {},
  },
]
GCLIENT
  # Do a shallow clone to save disk
  git clone --depth=1 --branch="$CHROMIUM_TAG" \
    https://chromium.googlesource.com/chromium/src.git src 2>/dev/null || \
  git clone --depth=1 \
    https://chromium.googlesource.com/chromium/src.git src
fi

cd src

# If we did a generic clone, try to checkout the tag
if ! git describe --tags --exact-match HEAD 2>/dev/null | grep -q "$CHROMIUM_TAG"; then
  git fetch --depth=1 origin "tag/$CHROMIUM_TAG" 2>/dev/null || \
  git fetch --depth=1 origin "+refs/tags/$CHROMIUM_TAG:refs/tags/$CHROMIUM_TAG" 2>/dev/null || true
  git checkout "$CHROMIUM_TAG" 2>/dev/null || git checkout "tags/$CHROMIUM_TAG" 2>/dev/null || true
fi

log "Step 3b/8: Running gclient sync (fetching dependencies)"
gclient sync --nohooks --no-history -D --shallow 2>&1 | tail -5

log "Step 3c/8: Running install-build-deps"
./build/install-build-deps.sh --no-prompt --no-chromeos-fonts 2>&1 | tail -5 || true

log "Step 3d/8: Running gclient runhooks"
gclient runhooks 2>&1 | tail -5

# ═══════════════════════════════════════════════════════════════
#  4. APPLY FULL AMI BROWSER BRANDING
#  Goal: ZERO traces of "Chromium" — like Microsoft Edge hides it
# ═══════════════════════════════════════════════════════════════
log "Step 4/8: Applying AMI Browser branding (full rebrand)"

cd "$BUILD_DIR/src"

# ── 4a. BRANDING master file ──
cat > chrome/app/theme/chromium/BRANDING <<'BRAND'
COMPANY_FULLNAME=AMI Exchange
COMPANY_SHORTNAME=AMI Exchange
PRODUCT_FULLNAME=AMI Browser
PRODUCT_SHORTNAME=AMI Browser
PRODUCT_INSTALLER_FULLNAME=AMI Browser Installer
PRODUCT_INSTALLER_SHORTNAME=AMI Browser
COPYRIGHT=Copyright 2024-2026 AMI Exchange. All rights reserved.
MAC_BUNDLE_ID=exchange.ami.browser
MAC_TEAM_ID=AMI
BRAND

# ── 4b. Replace "Chromium" in ALL string resource files (.grd, .grdp) ──
echo "  → Patching .grd/.grdp string resources..."
find chrome/ components/ ui/ -type f \( -name "*.grd" -o -name "*.grdp" \) | while read -r f; do
  if grep -ql 'Chromium' "$f" 2>/dev/null; then
    sed -i \
      -e 's/Chromium/AMI Browser/g' \
      "$f"
  fi
done

# ── 4c. Replace in .xtb translation files ──
echo "  → Patching .xtb translation files..."
find chrome/ components/ ui/ -type f -name "*.xtb" | while read -r f; do
  if grep -ql 'Chromium' "$f" 2>/dev/null; then
    sed -i 's/Chromium/AMI Browser/g' "$f"
  fi
done

# ── 4d. Chrome constants (binary name, process name) ──
echo "  → Patching chrome_constants.cc..."
if [[ -f chrome/common/chrome_constants.cc ]]; then
  sed -i \
    -e 's/"chromium"/"ami-browser"/g' \
    -e 's/"Chromium"/"AMI Browser"/g' \
    chrome/common/chrome_constants.cc
fi

# ── 4e. Product info strings ──
echo "  → Patching chrome_content_client.cc..."
if [[ -f chrome/app/chrome_content_client.cc ]]; then
  sed -i 's/"Chromium"/"AMI Browser"/g' chrome/app/chrome_content_client.cc
fi

# ── 4f. User agent string ──
echo "  → Patching user_agent.cc..."
find content/ chrome/ -name "*.cc" -path "*user_agent*" | while read -r f; do
  sed -i 's/"Chromium"/"AMIBrowser"/g; s/"chromium"/"ami-browser"/g' "$f"
done

# ── 4g. Window title, about:version, chrome://settings ──
echo "  → Patching browser_about_handler / version_ui..."
find chrome/browser/ -name "*.cc" -o -name "*.h" -print0 | xargs -0 grep -l '"Chromium"' 2>/dev/null | while read -r f; do
  sed -i 's/"Chromium"/"AMI Browser"/g' "$f"
done || true

# ── 4h. Update help page (chrome://settings/help) ──
echo "  → Patching settings/help page..."
find chrome/browser/ui/webui/settings/ -name "*.cc" -o -name "*.h" | while read -r f; do
  if grep -ql 'Chromium' "$f" 2>/dev/null; then
    sed -i 's/Chromium/AMI Browser/g' "$f"
  fi
done

# ── 4i. "Customize Chromium" → "Customize AMI Browser" in NTP/side panel ──
echo "  → Patching NTP customize side panel..."
find chrome/browser/ui/ chrome/browser/new_tab_page/ -name "*.cc" -o -name "*.h" -o -name "*.ts" -o -name "*.html" 2>/dev/null | while read -r f; do
  if grep -ql 'Chromium' "$f" 2>/dev/null; then
    sed -i 's/Chromium/AMI Browser/g' "$f"
  fi
done

# Also patch the WebUI TypeScript/HTML for new tab page customize
find chrome/browser/resources/new_tab_page/ -type f 2>/dev/null | while read -r f; do
  if grep -ql 'Chromium' "$f" 2>/dev/null; then
    sed -i 's/Chromium/AMI Browser/g' "$f"
  fi
done

# ── 4j. Linux desktop entry template ──
echo "  → Patching Linux installer/desktop templates..."
find chrome/installer/linux/ -type f 2>/dev/null | while read -r f; do
  if grep -ql 'chromium\|Chromium' "$f" 2>/dev/null; then
    sed -i 's/chromium-browser/ami-browser/g; s/chromium/ami-browser/g; s/Chromium/AMI Browser/g' "$f"
  fi
done

# ── 4k. Product logo / branding dir ──
echo "  → Patching branding references..."
find chrome/app/ -name "*.gni" -o -name "*.gn" | while read -r f; do
  if grep -ql 'chromium_product_name\|product_name.*Chromium' "$f" 2>/dev/null; then
    sed -i 's/"Chromium"/"AMI Browser"/g' "$f"
  fi
done

# ── 4l. content_strings (the fallback product name in content shell) ──
find content/ -name "*.grd" -o -name "*.grdp" | while read -r f; do
  if grep -ql 'Chromium' "$f" 2>/dev/null; then
    sed -i 's/Chromium/AMI Browser/g' "$f"
  fi
done

# ── 4m. about_flags.cc — "Chromium experiments" ──
echo "  → Patching chrome://flags..."
find chrome/browser/ -name "about_flags*" | while read -r f; do
  sed -i 's/Chromium/AMI Browser/g' "$f" 2>/dev/null || true
done

# ── 4n. extension_system hardcoded strings ──
echo "  → Patching extension system strings..."
find extensions/ chrome/browser/extensions/ -name "*.cc" -print0 | xargs -0 grep -l '"Chromium"' 2>/dev/null | while read -r f; do
  sed -i 's/"Chromium"/"AMI Browser"/g' "$f"
done || true

# ── 4o. crash reporter / UMA brand ──
find components/crash/ chrome/browser/metrics/ -name "*.cc" -print0 2>/dev/null | xargs -0 grep -l 'Chromium' 2>/dev/null | while read -r f; do
  sed -i 's/"Chromium"/"AMI Browser"/g; s/Chromium/AMI Browser/g' "$f"
done || true

# ── 4p. Profile manager, welcome page ──
find chrome/browser/ui/views/ -name "*.cc" -print0 | xargs -0 grep -l 'Chromium' 2>/dev/null | while read -r f; do
  sed -i 's/"Chromium"/"AMI Browser"/g; s/Chromium/AMI Browser/g' "$f"
done || true

# ── 4q. FINAL SWEEP: any remaining "Chromium" in C++ code (aggressive) ──
echo "  → Final sweep: remaining Chromium references in chrome/ and components/..."
find chrome/ components/ -name "*.cc" -o -name "*.h" -o -name "*.mm" -print0 | \
  xargs -0 grep -l '"Chromium"' 2>/dev/null | while read -r f; do
  sed -i 's/"Chromium"/"AMI Browser"/g' "$f"
done || true

echo "  ✓ Branding complete."

# ── 4r. Chrome Web Store "Add to Chrome" → "Add to AMI Browser" ──
echo "  → Patching Chrome Web Store button text..."
# Patch the CWS-related strings in .grd/.grdp files
find chrome/ components/ -type f \( -name "*.grd" -o -name "*.grdp" \) | while read -r f; do
  if grep -ql 'Add to Chrome\|Añadir a Chrome\|Ajouter à Chrome' "$f" 2>/dev/null; then
    sed -i \
      -e 's/Add to Chrome/Add to AMI Browser/g' \
      -e 's/Añadir a Chrome/Añadir a AMI Browser/g' \
      -e 's/Ajouter à Chrome/Ajouter à AMI Browser/g' \
      -e 's/Hinzufügen zu Chrome/Hinzufügen zu AMI Browser/g' \
      "$f"
  fi
done

# ── 4s. Default browser check: "AMI Browser" not "Chromium" ──
echo "  → Patching default browser check strings..."
# The default browser infobar says "Chromium is not your default browser"
# Already handled by the global Chromium→AMI Browser replacement,
# but also patch the specific default_browser strings
find chrome/browser/ui/ -name "*.cc" -o -name "*.h" | while read -r f; do
  if grep -ql 'default.*browser\|not your default' "$f" 2>/dev/null; then
    sed -i 's/Chromium is not your default browser/AMI Browser is not your default browser/g' "$f" 2>/dev/null || true
  fi
done

# ── 4t. Hide "Switch to Chrome" messaging in WebUI ──
echo "  → Patching WebUI chrome promo strings..."
find chrome/ components/ -type f \( -name "*.grd" -o -name "*.grdp" \) | while read -r f; do
  if grep -ql 'Switch to Chrome' "$f" 2>/dev/null; then
    sed -i 's/Switch to Chrome/Switch to AMI Browser/g' "$f" 2>/dev/null || true
  fi
done

echo "  ✓ CWS & default browser branding complete."

# ── 4u. Replace product logo images with AMI Browser logo ──
echo "  → Generating AMI Browser product logos..."
# Create a simple AMI logo SVG and convert to PNGs for all required sizes
AMI_LOGO_SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#a855f7"/><stop offset="100%" stop-color="#6d28d9"/></linearGradient></defs>
  <circle cx="128" cy="128" r="120" fill="url(#g)"/>
  <text x="128" y="160" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="100" fill="white">A</text>
</svg>'

# Replace Chromium logo PNGs with AMI purple logo using ImageMagick (if available) or Python
if command -v convert >/dev/null 2>&1; then
  echo "$AMI_LOGO_SVG" > /tmp/ami_logo.svg
  for size in 16 24 32 48 64 128 256; do
    convert -background none -resize "${size}x${size}" /tmp/ami_logo.svg /tmp/ami_logo_${size}.png 2>/dev/null || true
  done
elif command -v python3 >/dev/null 2>&1; then
  python3 -c "
import subprocess, os
svg = '''$AMI_LOGO_SVG'''
open('/tmp/ami_logo.svg','w').write(svg)
# Try rsvg-convert
for size in [16,24,32,48,64,128,256]:
    try:
        subprocess.run(['rsvg-convert','-w',str(size),'-h',str(size),'/tmp/ami_logo.svg','-o',f'/tmp/ami_logo_{size}.png'], check=True, capture_output=True)
    except: pass
" 2>/dev/null || true
fi

# Replace Chromium product logos in source tree
for logodir in chrome/app/theme/chromium chrome/app/theme/default_100_percent/chromium chrome/app/theme/default_200_percent/chromium; do
  if [[ -d "$logodir" ]]; then
    for pngfile in "$logodir"/product_logo_*.png; do
      if [[ -f "$pngfile" ]]; then
        # Extract size from filename (e.g., product_logo_128.png -> 128)
        size=$(echo "$pngfile" | grep -oP '\d+(?=\.png)')
        if [[ -f "/tmp/ami_logo_${size}.png" ]]; then
          cp "/tmp/ami_logo_${size}.png" "$pngfile"
          echo "    Replaced: $pngfile"
        fi
      fi
    done
  fi
done

echo "  ✓ Logo replacement complete."

# ═══════════════════════════════════════════════════════════════
#  5. CONFIGURE BUILD
# ═══════════════════════════════════════════════════════════════
log "Step 5/8: Configuring GN build args"

BUILD_OUT="out/Release"
mkdir -p "$BUILD_OUT"
cat > "$BUILD_OUT/args.gn" <<'GN'
# AMI Browser build config — optimized for low-memory server
is_official_build = true
is_debug = false
is_component_build = false
is_chrome_branded = false

# Minimize memory usage during build
symbol_level = 0
blink_symbol_level = 0
use_thin_lto = false
is_cfi = false
chrome_pgo_phase = 0

# Use system toolchain
use_sysroot = true
use_lld = true

# Disable stuff we don't need
treat_warnings_as_errors = false
enable_iterator_debugging = false

# Media — enable proprietary codecs for YouTube/H.264/AAC support
ffmpeg_branding = "Chrome"
proprietary_codecs = true

# Parallel linking (56GB RAM allows ~4 concurrent link jobs)
concurrent_links = 4
GN

gn gen "$BUILD_OUT" 2>&1 | tail -5

# ═══════════════════════════════════════════════════════════════
#  6. BUILD
# ═══════════════════════════════════════════════════════════════
log "Step 6/8: Building AMI Browser (this will take a while on $NPROC cores)..."

# 56GB RAM / 16 cores — use most cores, keep headroom
JOBS=$((NPROC > 2 ? NPROC - 2 : NPROC))
ninja -C "$BUILD_OUT" -j"$JOBS" chrome chrome_sandbox 2>&1 | tail -20

log "Build complete!"
ls -lh "$BUILD_OUT/chrome"

# ═══════════════════════════════════════════════════════════════
#  7. VERIFY BRANDING
# ═══════════════════════════════════════════════════════════════
log "Step 7/8: Verifying branding"

# Check the binary for residual "Chromium" strings
CHROMIUM_COUNT=$(strings "$BUILD_OUT/chrome" | grep -c "Chromium" || true)
echo "  Residual 'Chromium' strings in binary: $CHROMIUM_COUNT"
if [[ "$CHROMIUM_COUNT" -gt 0 ]]; then
  echo "  (Some may be in third-party code references, reviewing...)"
  strings "$BUILD_OUT/chrome" | grep "Chromium" | head -20
fi

# Check for our branding
AMI_COUNT=$(strings "$BUILD_OUT/chrome" | grep -c "AMI Browser" || true)
echo "  'AMI Browser' strings in binary: $AMI_COUNT"

# ═══════════════════════════════════════════════════════════════
#  8. PACKAGE
# ═══════════════════════════════════════════════════════════════
log "Step 8/8: Packaging"

PACKAGE_DIR="/root/ami-browser-linux64"
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"

cp "$BUILD_OUT/chrome" "$PACKAGE_DIR/ami-browser"
cp "$BUILD_OUT/chrome_sandbox" "$PACKAGE_DIR/chrome-sandbox" 2>/dev/null || true
cp "$BUILD_OUT/chrome_crashpad_handler" "$PACKAGE_DIR/" 2>/dev/null || true
cp "$BUILD_OUT/libEGL.so" "$PACKAGE_DIR/" 2>/dev/null || true
cp "$BUILD_OUT/libGLESv2.so" "$PACKAGE_DIR/" 2>/dev/null || true
cp "$BUILD_OUT/libvk_swiftshader.so" "$PACKAGE_DIR/" 2>/dev/null || true
cp "$BUILD_OUT/libvulkan.so.1" "$PACKAGE_DIR/" 2>/dev/null || true
cp "$BUILD_OUT/vk_swiftshader_icd.json" "$PACKAGE_DIR/" 2>/dev/null || true
cp -r "$BUILD_OUT/locales" "$PACKAGE_DIR/" 2>/dev/null || true
cp "$BUILD_OUT"/*.pak "$PACKAGE_DIR/" 2>/dev/null || true
cp "$BUILD_OUT"/*.bin "$PACKAGE_DIR/" 2>/dev/null || true
cp "$BUILD_OUT/icudtl.dat" "$PACKAGE_DIR/" 2>/dev/null || true

chmod 4755 "$PACKAGE_DIR/chrome-sandbox" 2>/dev/null || true
chmod +x "$PACKAGE_DIR/ami-browser"

cd /root
tar czf ami-browser-linux64.tar.gz ami-browser-linux64/
ls -lh ami-browser-linux64.tar.gz

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ AMI Browser built and packaged!"
echo "  📦 /root/ami-browser-linux64.tar.gz"
echo "═══════════════════════════════════════════════════"

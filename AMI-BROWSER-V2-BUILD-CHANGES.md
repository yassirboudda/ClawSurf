# AMI Browser v2.1 — C++ Rebuild Change List

> **Target Base:** Chromium 146.0.7680.80
> **Goal:** Zero "Chromium" leaks + better UX/UI than Brave
> **Last updated:** 2025-07-13

---

## Table of Contents

1. [CRITICAL FIXES — Bugs to Resolve](#1-critical-fixes--bugs-to-resolve)
2. [BRANDING — Build-Script Improvements](#2-branding--build-script-improvements)
3. [C++ UI/UX — Native Features to Add](#3-c-uiux--native-features-to-add)
4. [DEFAULT SETTINGS — Ship Better Defaults](#4-default-settings--ship-better-defaults)
5. [EXTENSION SYSTEM — Built-in Integration](#5-extension-system--built-in-integration)
6. [PACKAGING & DISTRIBUTION](#6-packaging--distribution)
7. [CURRENT WORKAROUNDS TO REMOVE](#7-current-workarounds-to-remove)
8. [BRAVE FEATURE PARITY & BEYOND](#8-brave-feature-parity--beyond)

---

## 1. CRITICAL FIXES — Bugs to Resolve

### 1.1 User-Agent String BREAKS Google (Captcha / Bot Detection)
- **Problem:** Build script step 4f replaces `"Chromium"` with `"AMIBrowser"` in `user_agent.cc`. Google doesn't recognize this token and flags the browser as a bot → endless captchas on Google Search, YouTube, Gmail.
- **Current workaround:** Launcher overrides UA with `--user-agent="Chrome/146.0.0.0"` flag.
- **Fix in C++ rebuild:**
  - In step 4f, **do NOT** touch the UA product token. Keep `"Chrome"` as the product token in the UA string (this is what Edge, Brave, Opera, Vivaldi all do).
  - Only replace the `"Chromium"` branding in the `application_name` / `GetProduct()` fields, NOT in `BuildUserAgentFromProduct()` or `user_agent_utils.cc`.
  - The UA should read: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.80 Safari/537.36`
  - **File:** `content/common/user_agent.cc`, `components/embedder_support/user_agent_utils.cc`

### 1.2 Right-Click Context Menu & Copy/Paste Broken
- **Problem:** User cannot right-click to see context menu, and Ctrl+C / text selection copy fails on many pages.
- **Root cause:** The aggressive `.grd` / `.grdp` blanket `sed 's/Chromium/AMI Browser/g'` corrupts resource string IDs and XML attributes that happen to contain the substring "Chromium". When a resource ID or XML tag gets mangled, the corresponding UI element (context menu, clipboard) silently breaks.
- **Fix in C++ rebuild:**
  - Change the `.grd`/`.grdp` replacement to ONLY target the *text content* inside `<message>` tags, NOT attribute values, NOT `<part>` file references, NOT `name=` attributes.
  - Use a smarter regex: `sed -i 's|>Chromium<|>AMI Browser<|g; s|"Chromium |"AMI Browser |g'` instead of the blanket `s/Chromium/AMI Browser/g`.
  - **Or better:** Use a Python script that parses the XML and only replaces text nodes, preserving all attributes.
  - Test after patching: `chrome://inspect`, right-click on any page, Ctrl+C, Ctrl+V must all work.
  - **Files:** All `.grd`, `.grdp`, `.xtb` files in `chrome/`, `components/`, `ui/`

### 1.3 Residual "Chromium" Strings (887 found in binary)
- **Problem:** `strings ami-browser | grep Chromium` still shows ~887 occurrences, mostly from WebRTC, Blink internals, third-party libs.
- **Fix:** These are mostly harmless (internal code comments, protocol strings) but visible in `chrome://version`. Target the **user-visible** ones:
  - `chrome://about` — "About Chromium" → "About AMI Browser"
  - `chrome://version` — product name line
  - `chrome://settings/help` — update section text
  - Window title fallback
  - Profile manager "Welcome to Chromium"
  - Task manager "Chromium Helper"
  - **Do NOT** replace in third-party/WebRTC/v8 code — it breaks builds.

---

## 2. BRANDING — Build-Script Improvements

### 2.1 .grd/.grdp Patching (REWRITE NEEDED)
- Current approach is a blanket `sed 's/Chromium/AMI Browser/g'` which is too aggressive.
- **New approach:** Write a Python script (`patch_grd_strings.py`) that:
  1. Parses each `.grd`/`.grdp` as XML
  2. Only replaces "Chromium" in `<message>` text content and `<ph>` descriptions
  3. Leaves `name=`, `translateable=`, file paths, and other attributes intact
  4. Handles edge cases: "Chromium OS" → skip (we're not ChromeOS), "Chromium-based" → "AMI Browser-based"
- **Benefit:** Eliminates the context menu / copy-paste corruption bug.

### 2.2 .xtb Translation Files
- Same fix needed: only replace within `<translation>` text content.
- Current blanket `sed 's/Chromium/AMI Browser/g'` on `.xtb` files may break translation IDs.

### 2.3 Product Logo — Use Real AMI Logo (Not Generated SVG)
- Current: Build script generates a simple purple "A" SVG and converts to PNG.
- **Fix:** Bundle real AMI Exchange logo files (designed in Figma/Illustrator) in the repo under `build/assets/`:
  - `product_logo_16.png`, `product_logo_24.png`, `product_logo_32.png`, `product_logo_48.png`, `product_logo_64.png`, `product_logo_128.png`, `product_logo_256.png`
  - `.ico` for Windows (future)
  - `.icns` for macOS (future)
  - SVG source file
- Copy them directly instead of generating with ImageMagick.

### 2.4 Linux Desktop Entry
- Already patching `chrome/installer/linux/` — verify the `.desktop` file gets:
  - `Name=AMI Browser`
  - `Exec=ami-browser %U`
  - `Icon=ami-browser`
  - Correct `MimeType` for web handler
  - `StartupWMClass=AMI-Browser` (matches `--class=AMI-Browser`)

### 2.5 Chrome Web Store Strings (Compile-Time)
- Step 4r already patches "Add to Chrome" → "Add to AMI Browser" in `.grd` files.
- **Also patch:** "Available on the Chrome Web Store" → "Available on AMI Store" (if we host our own store eventually).
- **Also patch:** "Get more extensions" link in `chrome://extensions` to point to our own store or curated list.

---

## 3. C++ UI/UX — Native Features to Add

### 3.1 AMI Shield in Toolbar (Like Brave Shields)
- **Goal:** A native toolbar button (like Brave's lion icon) showing a shield icon with a counter badge.
- **Implementation:**
  - Add a `ToolbarActionViewController` subclass for AMI Shield.
  - Register it in `chrome/browser/ui/views/toolbar/toolbar_view.cc`.
  - Show blocked tracker/ad count as a badge number.
  - Clicking opens a popup panel (WebUI or native view) with:
    - Toggle for shields on/off per site
    - Blocked trackers count
    - Fingerprinting protection toggle
    - Cookie blocking level
- **Easier alternative:** Keep as extension but with compile-time toolbar pin + native-looking popup.

### 3.2 AMI Sidebar (Like Brave Sidebar / Edge Sidebar)
- **Goal:** Built-in sidebar with AMI Hub (chat, connections, automations) accessible via side panel.
- **Implementation:**
  - Register AMI Hub as a SidePanel entry in `chrome/browser/ui/views/side_panel/`.
  - Use `SidePanelRegistry` to add "AMI Hub" as a built-in panel.
  - Keyboard shortcut: `Ctrl+Shift+A` (currently handled by extension, move to C++).
  - Sidebar should show: AI Chat, Connections, Automations, Shortcuts.

### 3.3 Wallet Button in Toolbar (Like Brave Wallet)
- **Goal:** Native toolbar button for AMI Wallet (crypto wallet).
- Show wallet icon in toolbar, click to open popup.
- Support Core Wallet (the actual wallet) as the backend.
- Toolbar button with dropdown for quick balance check.

### 3.4 Custom New Tab Page (Built-in, not extension)
- Current: Hub extension overrides NTP. This causes a flash of white before the extension loads.
- **Fix:** Build NTP as a WebUI page at `chrome://newtab-ami/` or modify the default NTP.
- Include: search bar, shortcuts grid, AI quick-access, recent connections.
- Use Chromium's `NewTabUI` class to register custom NTP.

### 3.5 AMI Theme — Default Dark/Purple Theme
- **Goal:** Ship with AMI's purple accent (#7c3aed) as default theme.
- Modify `chrome/browser/themes/` default colors:
  - Toolbar: `#1a1a2e` (dark navy)
  - Active tab: `#16213e`
  - Accent/highlight: `#7c3aed` (AMI purple)
  - NTP background: dark gradient
- Still allow users to change themes via chrome://settings/appearance.

### 3.6 Speed Reader Mode
- Brave has a Reader Mode that strips page clutter. Add one for AMI.
- Show a book icon in the address bar for article pages.
- Use `dom_distiller` (already in Chromium) but expose it more prominently.

---

## 4. DEFAULT SETTINGS — Ship Better Defaults

### 4.1 Default Search Engine: DuckDuckGo
- **Current workaround:** Hub extension `handleSearch()` uses DuckDuckGo.
- **C++ fix:** Modify `chrome/browser/search_engines/template_url_prepopulate_data.cc`:
  - Set `default_search_provider_index = <duckduckgo-index>`
  - Or modify the `kPrepopulatedEngines` array to put DuckDuckGo first.
- File: `components/search_engines/template_url_prepopulate_data.cc`
- Omnibox search should also use DuckDuckGo.

### 4.2 Disable Telemetry & Google Services by Default
- Set these GN args or runtime defaults:
  ```
  enable_reporting = false
  safe_browsing_mode = 0
  enable_hangout_services_extension = false
  ```
- Disable or remove:
  - GCM (Google Cloud Messaging) — already getting errors
  - UMA/UKM metrics reporting
  - Safe Browsing pings
  - Spelling service
  - Translate service (keep local translation)
  - Chrome Sync UI (replace with AMI Sync later)
- File: `chrome/browser/prefs/browser_prefs.cc` — set defaults

### 4.3 Privacy Defaults (Better Than Brave)
- `block_third_party_cookies = true` (default)
- `do_not_track = true` (default)
- `webrtc_ip_handling_policy = "disable_non_proxied_udp"` (prevent WebRTC IP leak)
- Disable `idle_detection` API by default
- Disable `battery_status` API by default (fingerprinting vector)
- Disable `navigator.connection` (fingerprinting vector)

### 4.4 Performance Defaults
- Enable tab discarding for background tabs (memory saver)
- Enable `PartitionedCookies`
- Enable `BackForwardCache`
- Disable `heavy_ad_intervention` (AMI Shield handles this)

### 4.5 Extension Permissions
- Auto-allow AMI's own extensions (Shield, Hub, Wallet, WebStore) without user prompt.
- Whitelist their extension IDs in `chrome/browser/extensions/extension_install_allowlist.cc`.

---

## 5. EXTENSION SYSTEM — Built-in Integration

### 5.1 Bundle Extensions in the Binary
- **Goal:** Ship AMI Shield, AMI Hub, AMI Wallet, AMI WebStore as component extensions (like PDF viewer in Chrome).
- **Implementation:**
  - Place extension source in `chrome/browser/resources/ami_shield/` etc.
  - Register in `chrome/browser/extensions/component_loader.cc` using `Add()`.
  - They load automatically without `--load-extension` flag.
  - Updates can be pushed via extension update mechanism.
- **Benefit:** No more `--load-extension` in launcher, cleaner, more stable.

### 5.2 Auto-Pin to Toolbar
- Component extensions can be auto-pinned via:
  - `ExtensionActionAPI::SetBrowserActionVisibility()` in C++
  - Or set `pinned_extensions` in the default profile `Preferences`.
- Pin order: AMI Shield, AMI Hub, AMI Wallet (left to right).

### 5.3 AMI Web Store as Default Extension Source
- Override the Chrome Web Store URL in `extensions::kWebstoreBaseURL`:
  - Keep CWS working for browsing/installing from it
  - But rebrand all "Chrome Web Store" text to "AMI Extension Store"
  - Change `chrome://extensions` "Get more extensions" link
- Future: Host our own Addons store at `https://store.ami.exchange/`

### 5.4 Remove Chrome-Specific Extension Prompts
- Hide "This extension is not from the Chrome Web Store" warnings for AMI extensions.
- Remove "Developer mode extensions" warning for built-in extensions.
- File: `chrome/browser/extensions/extension_install_prompt.cc`

---

## 6. PACKAGING & DISTRIBUTION

### 6.1 Linux (.deb + .rpm + AppImage)
- Create proper `.deb` package with:
  - `/usr/lib/ami-browser/` — binary + libs
  - `/usr/bin/ami-browser` — symlink
  - `/usr/share/applications/ami-browser.desktop`
  - `/usr/share/icons/hicolor/*/apps/ami-browser.png`
  - Proper `postinst` for mime-type registration
  - Dependency list (libnss3, libatk, etc.)
- Also build `.rpm` for Fedora/RHEL
- Also build AppImage for universal Linux

### 6.2 Auto-Updater
- Implement an update mechanism (check `https://updates.ami.exchange/latest` for new versions).
- Show update notification in settings/help.
- Download and replace binary on user confirmation.

### 6.3 Build Optimizations
- Current build takes ~4-6 hours on 16-core server.
- Optimize:
  - Use `ccache` to speed up rebuilds
  - Use `goma` or `AuoNinja` distributed builds if available
  - Consider `use_thin_lto = true` for smaller binary (if RAM allows)
  - Strip debug symbols: `strip ami-browser` saves ~100MB

---

## 7. CURRENT WORKAROUNDS TO REMOVE

These are runtime hacks in the launcher that should become unnecessary with proper C++ changes:

| Workaround | Where | Why it exists | How to fix in C++ |
|---|---|---|---|
| `--user-agent="Chrome/146..."` | Launcher ARGS | Build patches UA with "AMIBrowser" → Google captcha | Don't replace UA product token (§1.1) |
| `start_title_override()` xdotool loop | Launcher | Window titles show "Chromium" | Fix all .grd strings properly (§2.1) |
| `GOOGLE_API_KEY="no"` env vars | Launcher | Suppress "API keys missing" infobar | Build GN args: `google_api_key = ""` |
| `--disable-features=ExtensionServiceWorkerLifetimeV2` | Launcher | Keep MV3 service workers alive | Bundle extensions as component (§5.1) |
| Chrome-sandbox `.disabled` rename | Launcher | SUID bit missing on sandbox binary | Package with `chmod 4755` in .deb |
| Python toolbar pin script | Launcher | Extensions not pinned by default | Auto-pin in C++ (§5.2) |
| xdotool `--class AMI-Browser` | Launcher | WM class doesn't match | Set WM CLASS in C++ source |

---

## 8. BRAVE FEATURE PARITY & BEYOND

Features Brave has that AMI should match or exceed:

### Must-Have (Brave Parity)
- [x] Ad blocker (AMI Shield — done as extension)
- [x] Custom NTP with shortcuts (AMI Hub — done as extension)
- [x] Crypto wallet integration (AMI Wallet — done as extension)
- [ ] Built-in Tor/Private window with Tor
- [ ] IPFS gateway support
- [ ] Brave Rewards equivalent (AMI Rewards — placeholder exists)
- [ ] Vertical tabs option
- [ ] Tab grouping with visual colors
- [ ] Speed Reader mode (§3.6)
- [ ] Native ad-blocker in network layer (not extension-based — faster)
- [ ] Debouncing (skip tracking redirects)
- [ ] Cookie consent auto-dismiss

### Beyond Brave (AMI Differentiators)
- [ ] **Built-in AI Chat** with multi-provider support (OpenAI, Anthropic, Gemini, Mistral, etc.) — already in Hub extension
- [ ] **Browser Automation** — record and replay workflows, scheduled tasks
- [ ] **AI Agent** — built-in AI that can browse, fill forms, extract data
- [ ] **50+ AI/API Connections** — integrate directly with APIs from the browser
- [ ] **LinkedIn auto-apply** — built-in job application automation
- [ ] **Side-panel AI** — chat with any page, summarize, translate, extract
- [ ] **AMI Sync** — sync bookmarks, history, settings across devices (encrypted, self-hosted option)
- [ ] **Built-in VPN** (future) — better than Brave's Firewall+VPN
- [ ] **AMI Extension Store** — curated, faster, no Google dependency

---

## Build Server Requirements

- **CPU:** 16+ cores (32 recommended)
- **RAM:** 56GB+ (64GB recommended for `use_thin_lto = true`)
- **Disk:** 200GB+ SSD (Chromium source + build = ~150GB)
- **OS:** Ubuntu 22.04 LTS or 24.04 LTS
- **Time:** ~4-6 hours for clean build, ~30-60 min for incremental

---

## Quick Reference — Files to Modify

| Change | File(s) |
|---|---|
| UA string | `content/common/user_agent.cc`, `components/embedder_support/user_agent_utils.cc` |
| Product name | `chrome/app/theme/chromium/BRANDING` |
| Resource strings | All `.grd`/`.grdp` in `chrome/`, `components/`, `ui/` (use XML parser!) |
| Default search | `components/search_engines/template_url_prepopulate_data.cc` |
| Default privacy | `chrome/browser/prefs/browser_prefs.cc` |
| Toolbar buttons | `chrome/browser/ui/views/toolbar/toolbar_view.cc` |
| Side panel | `chrome/browser/ui/views/side_panel/` |
| Component ext | `chrome/browser/extensions/component_loader.cc` |
| NTP override | `chrome/browser/ui/webui/new_tab_page/` |
| Theme colors | `chrome/browser/themes/` |
| Window title | `chrome/browser/ui/browser.cc` (GetWindowTitleForCurrentTab) |
| Desktop entry | `chrome/installer/linux/common/installer.include` |
| Package (.deb) | `chrome/installer/linux/debian/` |
| GN args | `out/Release/args.gn` |

---

## Priority Order for C++ Modifications

1. **FIX User-Agent** (5 min) — Stop Google captchas
2. **FIX .grd patching** (2 hours) — Fix context menu + copy/paste
3. **FIX residual Chromium strings** (30 min) — Clean branding
4. **SET default search to DuckDuckGo** (15 min)
5. **SET privacy defaults** (30 min)
6. **BUNDLE extensions as components** (2-3 hours)
7. **ADD AMI Shield toolbar button** (4-6 hours)
8. **ADD AMI Sidebar panel** (4-6 hours)
9. **ADD custom NTP as WebUI** (3-4 hours)
10. **SET AMI purple theme** (1-2 hours)
11. **PACKAGE as .deb** (1-2 hours)
12. **Test everything** (2-3 hours)

---

*This document should be updated as changes are made. Check off items as they're completed during the C++ rebuild session.*

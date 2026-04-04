# AMI Browser v2.1 — C++ Rebuild Master Plan

> **Target Base:** Chromium 146.0.7680.80
> **Goal:** Zero "Chromium" leaks · Better UX/UI than Brave & Edge · Destroy Strawberry AI Browser
> **Last updated:** 2025-07-13
> **Document owner:** AMI Exchange Engineering

---

## Table of Contents

1. [CRITICAL BUGS — Must Fix Before Release](#1-critical-bugs--must-fix-before-release)
2. [FULL ERROR & FIX HISTORY](#2-full-error--fix-history)
3. [BRANDING — Build-Script Improvements](#3-branding--build-script-improvements)
4. [C++ UI/UX — Native Features](#4-c-uiux--native-features)
5. [DEFAULT SETTINGS — Ship Better Defaults](#5-default-settings--ship-better-defaults)
6. [EXTENSION SYSTEM — Built-in Integration](#6-extension-system--built-in-integration)
7. [BEAT MICROSOFT EDGE](#7-beat-microsoft-edge)
8. [BEAT BRAVE BROWSER](#8-beat-brave-browser)
9. [DESTROY STRAWBERRY AI BROWSER](#9-destroy-strawberry-ai-browser)
10. [PACKAGING & DISTRIBUTION](#10-packaging--distribution)
11. [CURRENT WORKAROUNDS TO REMOVE](#11-current-workarounds-to-remove)
12. [FULL FEATURE ROADMAP](#12-full-feature-roadmap)
13. [BUILD SERVER & QUICK REFERENCE](#13-build-server--quick-reference)

---

## 1. CRITICAL BUGS — Must Fix Before Release

### 1.1 User-Agent String BREAKS Google (Captcha / Bot Detection)
- **Status:** ⚠️ Workaround in place, needs C++ fix
- **Problem:** Build script step 4f replaces `"Chromium"` with `"AMIBrowser"` in `user_agent.cc`. Google doesn't recognize this token and flags the browser as a bot → endless captchas on Google Search, YouTube, Gmail.
- **Current workaround:** Launcher overrides UA with `--user-agent="Chrome/146.0.0.0"` flag (commit 1fd3aa5).
- **Fix in C++ rebuild:**
  - In step 4f, **do NOT** touch the UA product token. Keep `"Chrome"` as the product token in the UA string (this is what Edge, Brave, Opera, Vivaldi all do — they ALL report as `Chrome/xxx` in UA).
  - Only replace the `"Chromium"` branding in the `application_name` / `GetProduct()` fields, NOT in `BuildUserAgentFromProduct()` or `user_agent_utils.cc`.
  - The UA should read: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.80 Safari/537.36`
  - **Files:** `content/common/user_agent.cc`, `components/embedder_support/user_agent_utils.cc`
  - **Severity:** CRITICAL — without this, Google, YouTube, Gmail, reCAPTCHA, Cloudflare all fail

### 1.2 Right-Click Context Menu & Copy/Paste Broken
- **Status:** ❌ Not fixed — requires C++ rebuild
- **Problem:** User cannot right-click to see context menu on many pages, and Ctrl+C / text selection copy fails.
- **Investigation done:** Checked content-inject.js (no `contextmenu`/`copy`/`selectstart` listeners), cosmetic-filter.css (`pointer-events: none` only on ad selectors), background.js — NO extension is blocking it.
- **Root cause:** The aggressive `.grd` / `.grdp` blanket `sed 's/Chromium/AMI Browser/g'` corrupts resource string IDs and XML attributes that contain the substring "Chromium". When a `name=` attribute or `<part file="">` reference gets mangled, the corresponding UI element (context menu, clipboard integration, keyboard accelerators) silently breaks at runtime.
- **Fix in C++ rebuild:**
  - REWRITE `.grd`/`.grdp` patching to ONLY target *text content* inside `<message>` tags (see §3.1)
  - Use Python XML parser instead of blanket `sed`
  - Test after patching: right-click on any page, Ctrl+C, Ctrl+V, Ctrl+A, context menu "Copy", "Paste", "Inspect" must all work
  - **Files:** All `.grd`, `.grdp`, `.xtb` files in `chrome/`, `components/`, `ui/`
  - **Severity:** CRITICAL — fundamental browser functionality is broken

### 1.3 Residual "Chromium" Strings (887 in binary)
- **Status:** ⚠️ Partially addressed
- **Problem:** `strings ami-browser | grep Chromium` shows ~887 occurrences (mostly WebRTC, v8, third-party).
- **User-visible leaks to fix:**
  - `chrome://about` — "About Chromium" → "About AMI Browser"
  - `chrome://version` — product name line
  - `chrome://settings/help` — update section text
  - Window title fallback (currently hacked with xdotool)
  - Profile manager "Welcome to Chromium"
  - Task manager "Chromium Helper"
  - "Customize Chromium" in NTP side panel
  - Error pages "Chromium can't reach this page"
  - `chrome://flags` — "Chromium experiments"
- **Do NOT replace in:** third-party/, WebRTC/, v8/, skia/, angle/ — breaks builds

### 1.4 GCM Registration Errors (Google Cloud Messaging)
- **Status:** ⚠️ Suppressed with `--disable-background-networking`
- **Problem:** Console floods with `DEPRECATED_ENDPOINT`, `PHONE_REGISTRATION_ERROR` from GCM trying to register with Google servers.
- **Fix:** Disable GCM entirely at compile time:
  ```
  # In args.gn:
  enable_gcm_driver = false
  ```
  Or strip the GCM component from the build.
- **Files:** `components/gcm_driver/`, GN build configs

### 1.5 "Google API Keys Missing" Infobar
- **Status:** ⚠️ Suppressed with `GOOGLE_API_KEY="no"` env vars
- **Problem:** Yellow infobar appears saying "Google API keys are missing" because we don't ship Google's API keys.
- **Fix in C++:**
  - Set GN args: `google_api_key = ""`, `google_default_client_id = ""`, `google_default_client_secret = ""`
  - Or remove the infobar entirely: `chrome/browser/ui/startup/google_api_keys_infobar_delegate.cc`
  - **Severity:** Medium — cosmetic but unprofessional

### 1.6 SUID Sandbox Crash on Launch
- **Status:** ✅ Fixed with workaround (commit 8189447)
- **Problem:** `chrome-sandbox` needs SUID root bit (`chmod 4755`), otherwise Chromium crashes with "The SUID sandbox helper binary was found, but is not configured correctly."
- **Current workaround:** Launcher renames `chrome-sandbox` to `chrome-sandbox.disabled` to force kernel namespace sandbox fallback.
- **Fix in C++:** Package correctly with `.deb` postinst: `chmod 4755 /usr/lib/ami-browser/chrome-sandbox`
- **Also:** Add AppArmor profile for Ubuntu 24.04+ userns restriction (commit 55d598b already created this)

### 1.7 Extension URL Visible in Address Bar
- **Status:** ✅ Fixed (commit 7c42c43)
- **Problem:** `chrome-extension://pialalhaldelofpppfhkhlloniicmbdn/hub.html` showed in omnibox instead of clean URL.
- **Root cause:** Hub's `chat-input` auto-focus stole omnibox focus.
- **Fix applied:** Removed auto-focus on chat input.
- **C++ fix:** Build NTP as WebUI at `chrome://newtab/` — no extension URL to leak.

### 1.8 Flash of White on New Tab Before Extension Loads
- **Status:** ❌ Not fixed — requires C++ rebuild
- **Problem:** When opening a new tab, there's a brief white flash before the Hub extension NTP loads.
- **Fix:** Build the NTP as a native WebUI page (§4.4) — instant load, no extension overhead.

---

## 2. FULL ERROR & FIX HISTORY

Complete chronological log of every bug encountered and fixed:

| Commit | Date | Issue | Fix |
|--------|------|-------|-----|
| `551fd81` | — | Desktop entry broken: `/home/boudda` not expanded by sed | Fixed sed expansion, absolute icon path |
| `551fd81` | — | Broken simpleicons CDN URLs (mistral, groq, pinecone, stability) | Renamed URLs + SVG fallbacks |
| `551fd81` | — | Google CAPTCHA from custom `--user-agent` | Removed custom UA (later re-added properly) |
| `551fd81` | — | `--remote-debugging-port` in production launcher (security risk) | Removed |
| `551fd81` | — | Hub not responsive on small screens | Added breakpoints 1200px, 860px |
| `551fd81` | — | CWS "Switch to Chrome" banner visible | Created ami-webstore extension to hide it |
| `551fd81` | — | Core Wallet had no gateway integration | Redesigned ami-wallet as Core Wallet gateway |
| `7c42c43` | — | Extension URL in address bar | Removed chat-input auto-focus |
| `7c42c43` | — | GCM errors flooding console | Added `--disable-background-networking` |
| `81f2865` | — | Duplicate desktop entries from multiple installs | Cleaned up legacy aliases in install.sh |
| `8189447` | — | SUID sandbox crash on desktop launch | Auto-rename chrome-sandbox when not SUID root |
| `8189447` | — | chrome://newtab URL visible in address bar | Removed explicit NTP URL argument |
| `8189447` | — | GNOME dock icon not appearing | Added `StartupNotify=true` to desktop entry |
| `55d598b` | — | Ubuntu 24.04+ AppArmor blocks userns | Created AppArmor profile for ami-browser |
| `7e37a65` | — | simpleicons CDN URLs broken again | Replaced with inline SVG data URIs |
| `9bf902e` | — | "Customize Chromium" text in NTP | TreeWalker + MutationObserver rewrites |
| `9bf902e` | — | chrome-search:// pages show "Chromium" | Extended content-status.js to chrome:// pages |
| `3c5a813` | — | data: URI icons not rendering as images | Fixed icon rendering logic |
| `3c5a813` | — | Firewall badge not updating | Added badge update in checkServices() |
| `3c5a813` | — | API keys not synced from connections to agent | Auto-sync in agent config |
| `3c5a813` | — | No GPU acceleration / video laggy | Added GPU flags to launcher |
| `3c5a813` | — | YouTube H.264/AAC not playing | Enabled `proprietary_codecs = true` in build |
| `f8c382b` | — | Mistral 422 error: 'agent' not a valid role | Map 'agent' → 'assistant' in chat history |
| `f8c382b` | — | French/Spanish commands not recognized | Added multilingual intent detection |
| `f8c382b` | — | LLM responds with plain text instead of actions | Strengthened system prompt for JSON output |
| `e30f767` | — | "Couldn't reach the gateway" error | Production launcher now auto-starts gateway |
| `e30f767` | — | "Failed to load" model catalog | Gateway PID tracking + cleanup on exit |
| `46478bc` | — | CWS shows "Add to Chrome" button | Rewrote webstore.js to rebrand buttons |
| `46478bc` | — | "Switch to Chrome?" popup on CWS | Extension hides small-dimension dialogs with matching text |
| `46478bc` | — | Extensions not pinned to toolbar | Python script pins Shield/Hub/Wallet/WebStore |
| `46478bc` | — | AMI Wallet always redirects to CWS | Now opens Core Wallet directly if installed |
| `1fd3aa5` | — | Google captcha / bot detection | UA override with Chrome/146 token in launcher |
| `1fd3aa5` | — | Default search was Google | Changed to DuckDuckGo in hub.js |
| `1fd3aa5` | — | Connections page showing emoji (🧪✅❌) not logos | Added 40+ brand SVG icons |

### Still Unfixed (Need C++ Rebuild)
| Issue | Root Cause | Section |
|-------|-----------|---------|
| Right-click / context menu broken | .grd blanket sed corruption | §1.2 |
| Copy/paste broken (Ctrl+C fails) | .grd blanket sed corruption | §1.2 |
| Window title shows "Chromium" | Incomplete string replacement | §1.3 |
| NTP white flash before extension | NTP is extension-based, not native | §1.8 |
| "Developer mode extensions" warning | Extensions loaded via --load-extension | §6.1 |
| No default search in omnibox | DuckDuckGo only in hub, not omnibox | §5.1 |

---

## 3. BRANDING — Build-Script Improvements

### 3.1 .grd/.grdp Patching — REWRITE REQUIRED
- **Current:** Blanket `sed 's/Chromium/AMI Browser/g'` — breaks context menu, clipboard, keyboard shortcuts.
- **New approach:** Write `build/patch_grd_strings.py` that:
  ```python
  import xml.etree.ElementTree as ET
  import re, sys, glob

  for filepath in glob.glob('chrome/**/*.grd', recursive=True):
      tree = ET.parse(filepath)
      for msg in tree.iter('message'):
          # Only replace text content, preserve all attributes
          if msg.text and 'Chromium' in msg.text:
              msg.text = msg.text.replace('Chromium', 'AMI Browser')
          for child in msg:
              if child.tail and 'Chromium' in child.tail:
                  child.tail = child.tail.replace('Chromium', 'AMI Browser')
      tree.write(filepath, xml_declaration=True, encoding='utf-8')
  ```
  - Skip `name=` attributes, `<part file="">` references, `<if>` conditions
  - Handle edge cases: "Chromium OS" → SKIP, "Chromium-based" → "AMI Browser-based"
  - **CRITICAL:** This is the fix for §1.2 (right-click + copy/paste)

### 3.2 .xtb Translation File Patching
- Same Python XML parser approach: only replace within `<translation>` text nodes.
- Do NOT blanket-sed `.xtb` files (breaks translation fingerprint IDs that happen to contain hex matching "Chromium").

### 3.3 Product Logo — Real Designed Assets
- Current: Build script generates a placeholder purple "A" SVG.
- **Fix:** Design professional logo and bundle under `build/assets/`:
  - `product_logo_{16,24,32,48,64,128,256}.png`
  - `ami-browser.svg` (source)
  - `ami-browser.ico` (Windows, future)
  - `ami-browser.icns` (macOS, future)
  - Tray icon variants (light/dark)
- Copy directly in build step 4u instead of ImageMagick generation.

### 3.4 Linux Desktop Entry
- Verify `.desktop` file contains:
  ```ini
  [Desktop Entry]
  Name=AMI Browser
  Exec=ami-browser %U
  Icon=ami-browser
  Type=Application
  Categories=Network;WebBrowser;
  MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
  StartupWMClass=AMI-Browser
  StartupNotify=true
  ```

### 3.5 Chrome Web Store Strings (Compile-Time)
- Step 4r patches "Add to Chrome" → "Add to AMI Browser" in `.grd` files.
- **Also patch:** "Available on the Chrome Web Store" → "Available on AMI Store"
- **Also patch:** `chrome://extensions` "Get more extensions" link to our curated store
- **Also patch:** "Recommended for Chrome" → "Recommended for AMI Browser" in extension detail pages

---

## 4. C++ UI/UX — Native Features

### 4.1 AMI Shield Toolbar Button (Like Brave Shields — but better)
- **Goal:** Native toolbar button with shield icon + blocked count badge.
- **Why better than Brave:** Show per-site breakdown (ads blocked, trackers blocked, fingerprinting attempts, cookies blocked) in a beautiful dropdown — not just a toggle.
- **Implementation:**
  - `ToolbarActionViewController` subclass in `chrome/browser/ui/views/toolbar/`
  - Badge shows total blocks (red number like Brave)
  - Popup panel (WebUI) with:
    - Global on/off toggle
    - Per-site override
    - Blocked categories (ads, trackers, fingerprinting, cookies, cryptominers)
    - Stats chart (daily/weekly/monthly blocks)
    - "AMI Shield is protecting you" confidence message
- **Edge comparison:** Edge has no built-in ad blocker. AMI wins by default.

### 4.2 AMI Sidebar (Better than Edge Sidebar + Brave Sidebar)
- **Goal:** Side panel with AMI Hub (AI chat, connections, automations).
- **Why better than Edge Copilot:** AMI Hub supports 50+ AI providers (BYO keys), not locked to one vendor. User can switch between OpenAI, Anthropic, Gemini, Mistral, Groq, etc. in one click.
- **Why better than Brave Leo:** Leo only supports limited models. AMI Hub supports local models (Ollama, LM Studio), plus automation, connections, and agent capabilities.
- **Implementation:**
  - Register in `chrome/browser/ui/views/side_panel/`
  - Use `SidePanelRegistry` to add "AMI Hub" as built-in panel
  - Keyboard shortcut: `Ctrl+Shift+A`
  - Tabs within sidebar: Chat | Connections | Automations | Shortcuts

### 4.3 AMI Wallet Toolbar Button
- **Goal:** Native toolbar button for crypto wallet.
- **Why better than Brave Wallet:** Integrate with Core Wallet (Avalanche ecosystem) as backend, but also support MetaMask-compatible dApps.
- Toolbar button with dropdown: quick balance, recent transactions, quick send.

### 4.4 Custom New Tab Page (Built-in WebUI)
- **Current problem:** Hub extension overrides NTP → causes white flash (§1.8), shows extension URL.
- **Fix:** Build NTP as native WebUI at `chrome://newtab/`:
  - Use `NewTabUI` class to register custom page
  - Include: search bar (DuckDuckGo), quick shortcuts grid, AI chat quick access, weather, recent connections
  - Instant load — no extension overhead
  - **Better than Edge:** Edge NTP is cluttered with MSN news ads. AMI NTP is clean, AI-first.
  - **Better than Brave:** Brave NTP has Brave News (opt-in). AMI NTP has AI chat + automations built-in.

### 4.5 AMI Theme — Default Dark/Purple
- Ship with AMI's brand colors as default theme:
  - Toolbar: `#1a1a2e` (dark navy)
  - Active tab: `#16213e`
  - Accent: `#7c3aed` (AMI purple)
  - NTP background: dark gradient
  - Omnibox: dark with purple focus ring
- Modify `chrome/browser/themes/` default colors
- User can still change via `chrome://settings/appearance`

### 4.6 Smart Reader Mode (Better than Brave Speed Reader)
- Show book icon in address bar for article-type pages
- Use Chromium's `dom_distiller` but with better UI:
  - Custom fonts (serif/sans-serif/monospace toggle)
  - Dark/light/sepia modes
  - Font size slider
  - AI summary button: "Summarize this article" → uses connected AI provider
  - Text-to-speech with connected TTS provider (ElevenLabs, etc.)
- **Better than Brave:** Brave Speed Reader is basic text extraction. AMI Reader has AI summarization + TTS.

### 4.7 Web Capture / Screenshot Tool (Edge has this, Brave doesn't)
- **Goal:** Built-in screenshot tool accessible via `Ctrl+Shift+S`
- Options: Full page, selection, visible area
- Annotate: draw, highlight, text, arrows
- Share/copy/save
- **Why:** Edge has this and it's popular. Brave doesn't. Quick win.

### 4.8 Vertical Tabs (Edge has this, Brave recently added it)
- **Goal:** Option to show tabs vertically on the left side
- Tree-style tab grouping with visual hierarchy
- Collapsible sidebar
- **Why:** Edge's vertical tabs are very popular. AMI should have them from day one.

### 4.9 Tab Groups with Color Coding
- Chromium already has basic tab groups — enhance with:
  - Auto-group by domain
  - AI-suggested grouping: "Group these 5 tabs about 'machine learning' together?"
  - Save/restore tab groups across sessions
  - Named workspaces (like Edge Workspaces)

### 4.10 Drop / Cross-Device Sharing (Edge Feature)
- **Goal:** Share files, links, notes between devices via AMI account
- Edge has "Drop" — a lightweight cross-device sharing feature
- AMI can do this via the gateway/sync system
- Share links, images, text snippets, files up to 10MB

---

## 5. DEFAULT SETTINGS — Ship Better Defaults

### 5.1 Default Search Engine: DuckDuckGo
- **Current workaround:** Hub extension `handleSearch()` uses DuckDuckGo (commit 1fd3aa5).
- **C++ fix:** Modify `components/search_engines/template_url_prepopulate_data.cc`:
  - Set DuckDuckGo as first entry in `kPrepopulatedEngines` array
  - Or set `default_search_provider_index` to DuckDuckGo's index
  - This makes BOTH the omnibox and the NTP search use DuckDuckGo
- **Why DuckDuckGo:** Privacy-first (matches our brand), no tracking, no filter bubble. Strawberry browser also likely uses a privacy search engine.

### 5.2 Disable All Google Telemetry
- GN args:
  ```
  enable_reporting = false
  safe_browsing_mode = 0
  enable_hangout_services_extension = false
  enable_gcm_driver = false
  google_api_key = ""
  google_default_client_id = ""
  google_default_client_secret = ""
  ```
- Disable at runtime in `chrome/browser/prefs/browser_prefs.cc`:
  - UMA/UKM metrics: off
  - Safe Browsing pings: off (AMI Shield handles protection)
  - Spelling service: off (use local dictionary)
  - Translation service: keep local only
  - Chrome Sync UI: hidden (replace with AMI Sync later)
  - Prediction service: off
  - Navigation error suggestions: off (they ping Google)

### 5.3 Privacy Defaults (Better Than Brave AND Edge)
| Setting | AMI Default | Brave Default | Edge Default |
|---------|-------------|---------------|--------------|
| Third-party cookies | **Blocked** | Blocked | Allowed |
| Do Not Track | **Enabled** | Disabled | Disabled |
| WebRTC IP leak | **Prevented** | Prevented | Exposed |
| Fingerprinting protection | **Aggressive** | Standard | None |
| Idle detection API | **Disabled** | Disabled | Enabled |
| Battery status API | **Disabled** | Enabled | Enabled |
| navigator.connection | **Disabled** | Enabled | Enabled |
| Bounce tracking mitigations | **Enabled** | Enabled | Disabled |
| Third-party storage partitioning | **Enabled** | Enabled | Partial |
| Safe Browsing | **Local lists** | Local lists | Google-dependent |

### 5.4 Performance Defaults
- Tab discarding for background tabs (memory saver) — ON
- `PartitionedCookies` — ON
- `BackForwardCache` — ON
- Prerender2 — ON (fast page loads)
- `heavy_ad_intervention` — OFF (AMI Shield handles this)
- Tab sleep after 5 minutes inactive

### 5.5 Extension Permissions
- Auto-allow AMI's own built-in extensions without user prompt
- Whitelist their extension IDs in `chrome/browser/extensions/extension_install_allowlist.cc`
- No "Developer mode extensions" warning for built-in components

---

## 6. EXTENSION SYSTEM — Built-in Integration

### 6.1 Bundle Extensions as Components (Like Chrome PDF Viewer)
- **Goal:** Ship AMI Shield, AMI Hub, AMI Wallet, AMI WebStore as component extensions.
- **Implementation:**
  ```cpp
  // chrome/browser/extensions/component_loader.cc
  void ComponentLoader::AddAMIExtensions() {
    Add(IDR_AMI_SHIELD, base::FilePath("ami_shield"));
    Add(IDR_AMI_HUB, base::FilePath("ami_hub"));
    Add(IDR_AMI_WALLET, base::FilePath("ami_wallet"));
    Add(IDR_AMI_WEBSTORE, base::FilePath("ami_webstore"));
  }
  ```
  - Place extension source in `chrome/browser/resources/ami_*/`
  - Register in `chrome_browser_resources.grd`
  - Loaded automatically — no `--load-extension` needed
  - No "Developer mode" warning
  - Updates via extension update mechanism
- **Benefit:** Cleaner launcher, no startup flags, professional appearance

### 6.2 Auto-Pin to Toolbar
- Component extensions auto-pinned via `ExtensionActionAPI` at first run
- Pin order (left to right): AMI Shield, AMI Hub, AMI Wallet
- User can still unpin/rearrange

### 6.3 AMI Extension Store
- Override Chrome Web Store branding:
  - "Chrome Web Store" → "AMI Extension Store" everywhere
  - "Get more extensions" link → `https://store.ami.exchange/` (future)
  - Keep CWS functional for installing third-party extensions
- File: `extensions::kWebstoreBaseURL` and related strings

### 6.4 Remove Chrome-Specific Warnings
- Hide "This extension is not from the Chrome Web Store" for AMI extensions
- Hide "Developer mode extensions" for built-in components
- Hide "Disable developer mode" warning popup
- File: `chrome/browser/extensions/extension_install_prompt.cc`

---

## 7. BEAT MICROSOFT EDGE

Edge's strengths and how AMI beats each one:

| Edge Feature | Edge Implementation | AMI Counter | AMI Advantage |
|---|---|---|---|
| **Copilot AI** | Locked to Microsoft AI, sidebar-only | AMI Hub: 50+ providers, BYO keys, sidebar + NTP + floating widget | User choice, no vendor lock-in |
| **Vertical Tabs** | Built-in toggle | Same (§4.8) | Parity |
| **Collections** | Save/organize web pages | AMI Hub automations + saved workflows | More powerful (AI-enhanced) |
| **Immersive Reader** | Basic reader mode | AMI Reader: AI summarization + TTS (§4.6) | AI-powered |
| **Web Capture** | Screenshot + annotate | Built-in (§4.7) | Parity |
| **Drop** | Cross-device file sharing | AMI Sync (§12) | Privacy-first, self-hostable |
| **Edge Wallet** | Auto-fill payment info | AMI Wallet: full crypto wallet + payments | Web3 native |
| **Performance Mode** | Sleeping tabs, efficiency mode | Tab discarding + GPU acceleration | Parity |
| **Workspaces** | Multi-profile browsing | Tab groups + workspaces (§4.9) | Parity |
| **Math Solver** | Screenshots math → solutions | AI can do this via Hub chat | More versatile |
| **PDF Editor** | Built-in PDF markup | Can extend later | Edge wins here (for now) |
| **Coupons** | Price comparison shopping | Not planned | Edge wins here |
| **Ad Blocker** | None built-in | AMI Shield | AMI wins |
| **Crypto Wallet** | None | AMI Wallet | AMI wins |
| **Browser Automation** | None | TeachAnAgent + AI agent | AMI wins |
| **50+ API Connections** | None | AMI Hub connections | AMI wins |
| **Telemetry** | Heavy Microsoft telemetry | Zero telemetry | AMI wins |
| **Open Source** | Closed source | Open (when released) | AMI wins |

### Key Edge Features AMI MUST Ship:
1. ✅ AI sidebar (Hub is better — multi-provider)
2. ⬜ Vertical tabs (§4.8)
3. ⬜ Web capture / screenshot (§4.7)
4. ⬜ Reader mode with AI (§4.6)
5. ⬜ Tab groups with workspaces (§4.9)
6. ✅ Performance mode (GPU flags + tab discarding)

---

## 8. BEAT BRAVE BROWSER

Brave's strengths and how AMI beats each one:

| Brave Feature | Brave Implementation | AMI Counter | AMI Advantage |
|---|---|---|---|
| **Shields** | Native network-level ad blocker | AMI Shield (extension now, native later) | Moving to native (§4.1) |
| **Leo AI** | Limited models (Claude, Llama, Mixtral) | AMI Hub: 50+ providers, BYO keys, local models (Ollama) | Far more choice |
| **Brave Search** | Own search engine | DuckDuckGo default + can switch | More user choice |
| **Brave Rewards / BAT** | Opt-in ad viewing rewards | AMI Rewards (planned) | Coming |
| **Brave Wallet** | Built-in crypto wallet | AMI Wallet + Core Wallet integration | Parity |
| **Tor Private Window** | One-click Tor | Planned (§12) | Brave wins for now |
| **IPFS Gateway** | Built-in IPFS support | Planned (§12) | Brave wins for now |
| **Debouncing** | Skip tracking redirects | AMI Shield can add this | Coming |
| **Speed Reader** | Basic text extraction | AMI Reader: AI summary + TTS (§4.6) | Better |
| **Cookie consent auto-dismiss** | Auto-dismiss cookie banners | AMI Shield can add this rule list | Coming |
| **Vertical Tabs** | Recently added | Same (§4.8) | Parity |
| **Brave Talk** | Built-in video calls | Not planned | Brave wins |
| **Playlist** | Offline media/video player | Not planned | Brave wins |
| **Fingerprinting** | Randomized fingerprinting | Same approach (§5.3) | Parity |
| **Browser Automation** | None | TeachAnAgent + AI agent | **AMI wins** |
| **50+ API Connections** | None | AMI Hub connections | **AMI wins** |
| **AI Chat on any page** | Leo sidebar-only | Floating widget on every page + sidebar | **AMI wins** |
| **Multilingual AI** | English-centric | FR/ES/DE/PT/IT intent detection | **AMI wins** |
| **LinkedIn Auto-Apply** | None | Built-in extension | **AMI wins** |

### Key Brave Features AMI MUST Ship:
1. ✅ Ad blocker (Shield — moving to native)
2. ✅ Crypto wallet
3. ⬜ Tor private window
4. ⬜ Cookie consent auto-dismiss
5. ⬜ Debouncing (tracking redirect skip)
6. ⬜ Native ad blocker in network layer (faster than extension-based)
7. ✅ Fingerprinting protection
8. ✅ AI chat (better than Leo)

---

## 9. DESTROY STRAWBERRY AI BROWSER

> **Strawberry Browser** (by Dendrite Systems) is our #1 direct competitor — an AI-first browser that automates browser work.

### Strawberry's Pricing (Our Advantage #1: FREE)
| Plan | Strawberry Price | AMI Price |
|------|-----------------|-----------|
| Free | 2,000 credits/mo | **Unlimited (BYO keys)** |
| Intern | $20/mo (8K credits) | **$0 — use your own API keys** |
| Part-time | $100/mo (30K credits) | **$0** |
| Full-time | $250/mo (75K credits) | **$0** |
| Team | Custom pricing | **$0** |
| Extra credits | $10/1,000 credits | **N/A — no credit system** |

**AMI's killer advantage:** BYO keys (Bring Your Own Keys). Users connect their own OpenAI/Anthropic/Gemini API keys directly. No middleman markup. No credit limits. No subscription. An OpenAI API key costs ~$5-20/mo for heavy use — vs Strawberry's $100-250/mo for the same thing.

### Strawberry's Features vs AMI

| Capability | Strawberry | AMI Browser | AMI Advantage |
|---|---|---|---|
| **Platform** | macOS + Windows ONLY | **Linux + (future) macOS/Windows** | Linux first! |
| **AI Providers** | Proprietary (locked) | **50+ providers, BYO keys** | User choice, no lock-in |
| **Pricing** | $0-250/mo + credits | **Free forever + BYO keys** | Zero cost |
| **Sales Prospecting** | "Companions" automate sales | AI agent + browser automation | Comparable |
| **Recruiting** | "Recruiter Ryan" companion | LinkedIn AutoApply extension | Comparable |
| **Data Extraction** | "Point at any website" | AI agent can scrape + connections | Comparable |
| **Research** | AI reads and summarizes | AI chat + summarize any page | Comparable |
| **Marketing** | Track competitors, metrics | AI agent + automations | Comparable |
| **Operations** | Morning briefs, reports | Automations + scheduled tasks | Comparable |
| **Smart History** | NL search of browse history | Not yet | ⬜ Build this (§9.1) |
| **Approval Before Actions** | Companions ask approval | Shows action plan before executing | Comparable |
| **Ad Blocker** | None | **AMI Shield** | AMI wins |
| **Crypto Wallet** | None | **AMI Wallet** | AMI wins |
| **Privacy** | Data goes to CloudFlare | **Local-first, zero telemetry** | AMI wins |
| **Open Source** | Closed source, proprietary | **Open source** | AMI wins |
| **Local AI** | No (cloud-only) | **Ollama, LM Studio support** | AMI wins |
| **Offline Capability** | None (credit-dependent) | **Works with local models** | AMI wins |
| **Extension Support** | Unknown | **Full Chrome extensions** | AMI wins |
| **Customization** | Limited | **Full Chromium customization** | AMI wins |

### 9.1 Features to Build to Crush Strawberry

**MUST BUILD — Strawberry has, AMI doesn't:**

1. **Smart History Search** — Natural language search across browsing history
   - "Find the article about AI I read last Tuesday"
   - Index page titles, URLs, meta descriptions locally
   - Use connected AI provider for semantic search
   - Store index locally (privacy-first, unlike Strawberry which sends to CloudFlare)
   - **Implementation:** Background extension that captures page metadata on visit, stores in IndexedDB, uses AI for semantic matching

2. **AI Companions / Personas** — Pre-built AI agents for specific roles
   - "Sales Scout" — finds leads, updates CRM, drafts outreach
   - "Recruiter" — sources candidates on LinkedIn, logs to ATS
   - "Researcher" — deep competitive analysis, market reports
   - "Ops Manager" — morning briefs, follow-ups, weekly reports
   - "Data Extractor" — point at any page, get structured data
   - **Implementation:** Pre-configured agent personas with specific system prompts, tool access, and workflow templates stored in the hub

3. **Workflow Templates** — Pre-built automation recipes
   - "Prospect 100 companies from LinkedIn"
   - "Extract all email addresses from this page"
   - "Summarize these 10 tabs into a report"
   - "Monitor competitor pricing daily"
   - **Implementation:** TeachAnAgent recordings packaged as shareable templates

4. **Session Replay / Activity History** — Show user exactly what AI did
   - Strawberry shows "activity history of every action the AI companions make"
   - AMI should show: timeline of each page visited, each action taken, results
   - Exportable as report

**AMI's UNFAIR ADVANTAGES over Strawberry:**

1. **FREE** — Strawberry charges $20-250/mo. AMI is free with BYO keys.
2. **50+ AI providers** — Strawberry locked to their own AI. AMI uses ANY provider.
3. **Local AI** — AMI works with Ollama/LM Studio. Strawberry is cloud-only.
4. **Linux** — Strawberry doesn't run on Linux. AMI does.
5. **Ad blocker** — Strawberry has none. AMI has Shield.
6. **Crypto wallet** — Strawberry has none. AMI has Wallet.
7. **Privacy** — Strawberry sends data to CloudFlare. AMI is local-first.
8. **Open source** — Strawberry is closed. AMI can be audited.
9. **Chrome extensions** — Full Chrome Web Store compatibility.
10. **Offline** — AMI works offline with local models. Strawberry needs credits + internet.

### 9.2 Messaging Against Strawberry (Marketing)

**Landing page headline:**
> "Like Strawberry, but free. Like Brave, but with AI. Like Edge, but private."

**Key marketing points:**
- "Your keys. Your models. Your data. Zero subscription."
- "50+ AI providers. Strawberry gives you one."
- "Works offline. Strawberry doesn't."
- "Blocks ads. Strawberry doesn't."
- "Open source. Strawberry isn't."
- "Runs on Linux. Strawberry doesn't."

---

## 10. PACKAGING & DISTRIBUTION

### 10.1 Linux (.deb + .rpm + AppImage + Snap + Flatpak)
- **`.deb` package:**
  ```
  /usr/lib/ami-browser/ami-browser         (binary)
  /usr/lib/ami-browser/chrome-sandbox      (SUID 4755)
  /usr/lib/ami-browser/locales/            (language packs)
  /usr/lib/ami-browser/*.pak               (resources)
  /usr/lib/ami-browser/*.so                (shared libs)
  /usr/lib/ami-browser/extensions/ami_*/   (built-in extensions)
  /usr/bin/ami-browser                     (symlink)
  /usr/share/applications/ami-browser.desktop
  /usr/share/icons/hicolor/*/apps/ami-browser.png
  /usr/share/appdata/ami-browser.appdata.xml
  /etc/apparmor.d/ami-browser              (Ubuntu 24.04+)
  ```
  - `postinst`: chmod 4755 chrome-sandbox, update-desktop-database, update-mime-database
  - Dependencies: libnss3, libatk1.0-0, libcups2, libgbm1, libpango-1.0-0, libasound2
- **`.rpm`** for Fedora/RHEL/openSUSE
- **AppImage** for universal Linux (no install needed)
- **Snap** for Ubuntu Software Center
- **Flatpak** for Flathub

### 10.2 Auto-Updater
- Check `https://updates.ami.exchange/api/latest?os=linux&arch=x64` for new versions
- Show notification in `chrome://settings/help`: "AMI Browser X.Y is available"
- Background download + install on user confirmation
- Differential updates (don't re-download 400MB each time)

### 10.3 Build Optimizations
- Use `ccache` for faster rebuilds
- Use `sccache` (Rust-based, better than ccache) for distributed caching
- Strip symbols: `strip --strip-all ami-browser` saves ~100MB
- Consider `use_thin_lto = true` for smaller binary if RAM >= 64GB
- Enable `symbol_level = 0` to minimize debug info
- Use `goma` if Google allows (or `AuoNinja`)
- Estimated: 4-6hr clean build, 30-60min incremental on 16-core

### 10.4 CI/CD Pipeline (Future)
- GitHub Actions / self-hosted runner for automated builds
- On every merge to `main`: build → test → package → upload to releases
- Nightly builds for testing
- Stable channel releases monthly

---

## 11. CURRENT WORKAROUNDS TO REMOVE

These runtime hacks in the launcher should become unnecessary with proper C++ changes:

| # | Workaround | Location | Root Cause | C++ Fix |
|---|---|---|---|---|
| 1 | `--user-agent="Chrome/146..."` | Launcher ARGS | Build patches UA token | Don't replace UA token (§1.1) |
| 2 | `start_title_override()` xdotool loop | Launcher | Window titles show "Chromium" | Fix .grd strings properly (§3.1) |
| 3 | `GOOGLE_API_KEY="no"` env vars | Launcher | "API keys missing" infobar | GN args `google_api_key = ""` (§1.5) |
| 4 | `--disable-features=ExtensionServiceWorkerLifetimeV2` | Launcher | MV3 service workers die | Bundle as component extensions (§6.1) |
| 5 | Chrome-sandbox `.disabled` rename | Launcher | SUID missing on sandbox | Package with chmod 4755 in .deb (§1.6) |
| 6 | Python toolbar pin script | Launcher | Extensions not pinned | Auto-pin in C++ (§6.2) |
| 7 | `--class=AMI-Browser` xdotool | Launcher | WM class wrong | Set WM_CLASS in C++ source |
| 8 | `--disable-background-networking` | Launcher | GCM errors | Disable GCM at compile time (§1.4) |
| 9 | `--load-extension=...` (9 extensions) | Launcher | Not bundled | Component extensions (§6.1) |
| 10 | Node.js gateway auto-start | Launcher | Separate process needed | Eventually compile gateway into browser (long-term) |
| 11 | TreeWalker "Chromium"→"AMI Browser" | hub.html JS | NTP text not patched | Build NTP as WebUI (§4.4) |
| 12 | MutationObserver text rewriter | content-status.js | chrome:// pages show "Chromium" | Fix .grd strings (§3.1) |

**Target: launcher should be <20 lines after all C++ fixes.**

---

## 12. FULL FEATURE ROADMAP

### Phase 1: Bug-Free Release (v2.1) — Immediate
- [x] Fix Google captcha (UA override)
- [x] Fix DuckDuckGo as default search (hub.js)
- [x] Fix connections page brand logos
- [x] Fix gateway auto-start in production
- [x] Fix CWS "Add to Chrome" rebrand
- [x] Fix toolbar pinning
- [x] Fix Core Wallet redirect
- [x] Fix simpleicons CDN / SVG rendering
- [x] Fix GCM errors (suppressed)
- [x] Fix sandbox crash workaround
- [x] Fix extension URL in address bar
- [x] Fix multilingual AI intents (FR/ES/DE/PT/IT)
- [x] Fix role mapping for Mistral API
- [ ] **FIX right-click context menu** (C++ build)
- [ ] **FIX copy/paste** (C++ build)
- [ ] **FIX window title "Chromium"** (C++ build)
- [ ] **FIX NTP white flash** (C++ build)

### Phase 2: Professional Build (v2.2) — C++ Rebuild
- [ ] Proper .grd XML patching (Python parser)
- [ ] Proper UA string (keep Chrome token)
- [ ] DuckDuckGo as omnibox default
- [ ] All privacy defaults enabled
- [ ] All Google telemetry disabled
- [ ] Bundle extensions as components
- [ ] Auto-pin extensions to toolbar
- [ ] Remove all launcher workarounds
- [ ] AMI purple default theme
- [ ] Proper .deb and AppImage packaging
- [ ] No "Developer mode extensions" warning

### Phase 3: Feature Parity (v3.0) — Beat Edge & Brave
- [ ] AMI Shield as native toolbar button
- [ ] AMI Hub as native sidebar panel
- [ ] Custom NTP as WebUI
- [ ] Vertical tabs
- [ ] Tab groups with AI suggestions
- [ ] Web capture / screenshot tool
- [ ] Smart Reader mode with AI summary + TTS
- [ ] Tor private window
- [ ] Cookie consent auto-dismiss
- [ ] Debouncing (tracking redirect skip)
- [ ] Cross-device sync (AMI Sync)

### Phase 4: Destroy Strawberry (v4.0) — AI Dominance
- [ ] Smart History (NL search of browsing history)
- [ ] AI Companions / Personas (Sales, Recruiter, Researcher, etc.)
- [ ] Pre-built workflow templates
- [ ] Session replay / activity history
- [ ] AI data extraction (point → structured data)
- [ ] CRM integrations (Salesforce, HubSpot)
- [ ] ATS integrations (Greenhouse, Lever)
- [ ] Team features (shared automations, shared connections)
- [ ] AMI Extension Store (self-hosted)

### Phase 5: Market Leader (v5.0) — Beyond
- [ ] macOS + Windows builds
- [ ] Built-in VPN
- [ ] IPFS gateway
- [ ] Native ad blocker in network stack
- [ ] Built-in video conferencing (AMI Meet)
- [ ] AMI Rewards (token economy)
- [ ] Enterprise tier (admin controls, SSO, audit logs)
- [ ] Mobile browser (Android + iOS)
- [ ] AMI Cloud Sync (encrypted, self-hosted option)

---

## 13. BUILD SERVER & QUICK REFERENCE

### Server Requirements
| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 16 cores | 32 cores |
| RAM | 56 GB | 64 GB |
| Disk | 200 GB SSD | 500 GB NVMe |
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| Network | 100 Mbps | 1 Gbps |
| Clean build | ~6 hours | ~3 hours |
| Incremental | ~60 min | ~20 min |

### Quick Reference — Files to Modify

| Change | File(s) in Chromium Source |
|---|---|
| UA string | `content/common/user_agent.cc`, `components/embedder_support/user_agent_utils.cc` |
| Product name | `chrome/app/theme/chromium/BRANDING` |
| Resource strings | `.grd`/`.grdp` in `chrome/`, `components/`, `ui/` — **USE XML PARSER** |
| Default search | `components/search_engines/template_url_prepopulate_data.cc` |
| Privacy prefs | `chrome/browser/prefs/browser_prefs.cc` |
| Toolbar buttons | `chrome/browser/ui/views/toolbar/toolbar_view.cc` |
| Side panel | `chrome/browser/ui/views/side_panel/` |
| Component ext | `chrome/browser/extensions/component_loader.cc` |
| NTP override | `chrome/browser/ui/webui/new_tab_page/` |
| Theme colors | `chrome/browser/themes/` |
| Window title | `chrome/browser/ui/browser.cc` (`GetWindowTitleForCurrentTab`) |
| Desktop entry | `chrome/installer/linux/common/installer.include` |
| Deb package | `chrome/installer/linux/debian/` |
| GN args | `out/Release/args.gn` |
| Disable GCM | `components/gcm_driver/` |
| API key infobar | `chrome/browser/ui/startup/google_api_keys_infobar_delegate.cc` |
| Extension warnings | `chrome/browser/extensions/extension_install_prompt.cc` |
| WM_CLASS | `chrome/browser/ui/views/frame/browser_frame.cc` |
| Telemetry | `chrome/browser/metrics/`, `components/metrics/` |
| Reader mode | `components/dom_distiller/` |
| Vertical tabs | `chrome/browser/ui/views/tabs/` |

### Priority Order for C++ Build Session

| # | Task | Estimated Effort | Impact |
|---|------|-----------------|--------|
| 1 | FIX User-Agent (stop captchas) | 15 min | CRITICAL |
| 2 | FIX .grd patching → Python XML parser (fix context menu + copy) | 2 hours | CRITICAL |
| 3 | FIX residual Chromium strings (user-visible) | 30 min | HIGH |
| 4 | SET DuckDuckGo as omnibox default | 15 min | HIGH |
| 5 | SET privacy defaults + disable telemetry | 30 min | HIGH |
| 6 | SET GN args (GCM, API keys, etc.) | 15 min | HIGH |
| 7 | BUNDLE extensions as components | 2-3 hours | HIGH |
| 8 | ADD AMI purple theme | 1-2 hours | MEDIUM |
| 9 | ADD AMI Shield toolbar button | 4-6 hours | MEDIUM |
| 10 | ADD AMI Sidebar panel | 4-6 hours | MEDIUM |
| 11 | ADD custom NTP as WebUI | 3-4 hours | MEDIUM |
| 12 | ADD vertical tabs option | 2-3 hours | MEDIUM |
| 13 | ADD web capture tool | 1-2 hours | LOW |
| 14 | ADD reader mode with AI | 2-3 hours | LOW |
| 15 | PACKAGE as .deb + AppImage | 1-2 hours | HIGH |
| 16 | TEST everything | 2-3 hours | CRITICAL |

---

*This document is the master plan. Update it as changes are implemented. Check off items as they're completed during the C++ rebuild session.*

*Last updated by: AMI Exchange Engineering Team*

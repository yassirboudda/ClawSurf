/* AMI Web Store — Full CWS rebrand for AMI Browser */
'use strict';

(function() {
  const BRAND = 'AMI Browser';

  // ── 1. Replace "Add to Chrome" / "Add to Brave" / etc. button text ──
  function rebrandButtons() {
    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      const span = btn.querySelector('span') || btn;
      const txt = span.textContent || '';
      // Match "Add to Chrome", "Add to Brave", "Ajouter à Chrome", etc.
      if (/add to (chrome|brave|edge|chromium|opera)/i.test(txt)) {
        span.textContent = txt.replace(/add to (chrome|brave|edge|chromium|opera)/i, `Add to ${BRAND}`);
      } else if (/ajouter à (chrome|brave|edge|chromium)/i.test(txt)) {
        span.textContent = txt.replace(/ajouter à (chrome|brave|edge|chromium)/i, `Ajouter à ${BRAND}`);
      } else if (/añadir a (chrome|brave|edge|chromium)/i.test(txt)) {
        span.textContent = txt.replace(/añadir a (chrome|brave|edge|chromium)/i, `Añadir a ${BRAND}`);
      } else if (/hinzufügen.*?(chrome|brave|edge|chromium)/i.test(txt)) {
        span.textContent = txt.replace(/(chrome|brave|edge|chromium)/i, BRAND);
      } else if (/remove from (chrome|brave|edge|chromium)/i.test(txt)) {
        span.textContent = txt.replace(/remove from (chrome|brave|edge|chromium)/i, `Remove from ${BRAND}`);
      }
    }
  }

  // ── 2. Hide "Switch to Chrome?" popup/dialog ──
  function hideSwitchPopup() {
    // The popup is a floating card with "Switch to Chrome?" heading
    // It sits in a container that overlays the page
    document.querySelectorAll('div, aside, section, [role="dialog"], [role="alertdialog"]').forEach(el => {
      const text = el.textContent || '';
      if (/switch to chrome\??|wechseln sie zu chrome|passer à chrome|cambiar a chrome/i.test(text)) {
        // Only hide if it's a small popup (< 500px), not the full page
        const rect = el.getBoundingClientRect();
        if (rect.width < 600 && rect.height < 400) {
          el.style.setProperty('display', 'none', 'important');
          // Also hide the backdrop/overlay
          if (el.parentElement && el.parentElement !== document.body) {
            const parent = el.parentElement;
            const pRect = parent.getBoundingClientRect();
            if (pRect.width < 600) {
              parent.style.setProperty('display', 'none', 'important');
            }
          }
        }
      }
    });
  }

  // ── 3. Hide "Switch to Chrome to install extensions" info banner ──
  function hideSwitchBanner() {
    // Target the blue info banner by text content
    document.querySelectorAll('[role="banner"], [role="alert"], [role="status"], .CtSBdf, .hSHfTb').forEach(el => {
      const text = el.textContent || '';
      if (/switch to chrome|install(er|ieren).*?(extension|erweiter|thème)/i.test(text)) {
        el.style.setProperty('display', 'none', 'important');
      }
    });

    // Also scan for the info icon + text pattern used by modern CWS
    document.querySelectorAll('div').forEach(el => {
      const text = (el.textContent || '').trim();
      // Must contain "Switch to Chrome" AND "extensions" to be the banner
      if (/switch to chrome/i.test(text) && /extension|theme/i.test(text)) {
        // Ensure it's a banner-like element (full width, low height)
        const rect = el.getBoundingClientRect();
        if (rect.width > 400 && rect.height < 100) {
          el.style.setProperty('display', 'none', 'important');
        }
      }
    });
  }

  // ── 4. Replace "Google recommends using Chrome" text ──
  function rebrandText() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    const replacements = [
      [/Google recommends using Chrome when using extensions and themes\.?/gi,
       `Install extensions and themes directly in ${BRAND}.`],
      [/switch to chrome to install extensions and themes\.?/gi, ''],
    ];
    let node;
    while ((node = walker.nextNode())) {
      let changed = false;
      let val = node.nodeValue;
      for (const [pat, rep] of replacements) {
        if (pat.test(val)) {
          val = val.replace(pat, rep);
          changed = true;
        }
      }
      if (changed) node.nodeValue = val;
    }
  }

  // ── Run all fixes ──
  function applyFixes() {
    rebrandButtons();
    hideSwitchPopup();
    hideSwitchBanner();
    rebrandText();
  }

  // Initial run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyFixes);
  } else {
    applyFixes();
  }

  // Re-run on SPA navigation and dynamic content loading (CWS is a SPA)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(applyFixes, 300);
    }
    applyFixes();
  }).observe(document.body, { childList: true, subtree: true });
})();

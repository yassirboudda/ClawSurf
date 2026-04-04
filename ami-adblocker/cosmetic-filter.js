/* AMI Shield — Cosmetic filter (JS): removes ad elements that CSS alone can't catch */
(function amiShieldCosmetic() {
  'use strict';

  const AD_SELECTORS = [
    'iframe[src*="doubleclick"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="amazon-adsystem"]',
    'ins.adsbygoogle',
    '[id^="div-gpt-ad"]',
    '[data-google-query-id]',
    '[class*="ad-container"]',
    '[class*="sponsored"]',
    '[data-ad]',
    '[data-ad-slot]'
  ];

  function removeAds() {
    for (const sel of AD_SELECTORS) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        el.remove();
      }
    }
  }

  // Run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeAds);
  } else {
    removeAds();
  }

  // Observe for dynamically injected ads
  const observer = new MutationObserver((mutations) => {
    let needsScan = false;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) { needsScan = true; break; }
    }
    if (needsScan) removeAds();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

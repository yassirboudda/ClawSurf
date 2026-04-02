(() => {
  const ID = 'openclaw-relay-status-pill'

  // ── Title rewriter: replace "Chromium" with "AMI Browser" everywhere ──
  function rewriteTitle() {
    if (document.title.includes('Chromium')) {
      document.title = document.title.replace(/Chromium/g, 'AMI Browser')
    }
  }

  // ── Body text rewriter: replace visible "Chromium" in page content ──
  function rewriteBodyText() {
    // Only run on internal pages (chrome-extension://, about:, chrome://) and settings-like pages
    const loc = window.location.href
    if (!loc.startsWith('chrome-extension://') && !loc.startsWith('about:') && !loc.includes('settings')) return

    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, null)
    let node
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes('Chromium')) {
        node.nodeValue = node.nodeValue.replace(/Chromium/g, 'AMI Browser')
      }
    }
  }

  // Run once immediately and observe future changes
  rewriteTitle()
  rewriteBodyText()
  const titleObs = new MutationObserver(() => { rewriteTitle(); rewriteBodyText(); })
  const headEl = document.querySelector('head')
  if (headEl) {
    titleObs.observe(headEl, { childList: true, subtree: true, characterData: true })
  }
  // Also observe body for dynamic content changes
  const bodyObs = new MutationObserver(rewriteBodyText)
  if (document.body) {
    bodyObs.observe(document.body, { childList: true, subtree: true, characterData: true })
  }
  // Also watch after DOM ready in case <head> wasn't available at document_start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      rewriteTitle()
      rewriteBodyText()
      const h = document.querySelector('head')
      if (h) titleObs.observe(h, { childList: true, subtree: true, characterData: true })
      if (document.body) bodyObs.observe(document.body, { childList: true, subtree: true, characterData: true })
    }, { once: true })
  }

  // ── Status pill ──
  function ensurePill() {
    let el = document.getElementById(ID)
    if (el) return el

    el = document.createElement('div')
    el.id = ID
    el.style.position = 'fixed'
    el.style.right = '14px'
    el.style.bottom = '14px'
    el.style.zIndex = '2147483647'
    el.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    el.style.fontSize = '12px'
    el.style.fontWeight = '700'
    el.style.padding = '6px 10px'
    el.style.borderRadius = '999px'
    el.style.boxShadow = '0 6px 18px rgba(0,0,0,.25)'
    el.style.color = '#fff'
    el.style.pointerEvents = 'none'
    el.style.userSelect = 'none'
    el.style.letterSpacing = '.2px'
    el.style.transition = 'background .3s, opacity .3s'
    document.documentElement.appendChild(el)
    return el
  }

  function paint(kind) {
    const el = ensurePill()
    if (kind === 'on') {
      el.textContent = '🟢 AMI: LISTENING'
      el.style.background = 'linear-gradient(135deg,#10b981,#059669)'
      el.style.opacity = '0.92'
      return
    }
    if (kind === 'cdp-only') {
      el.textContent = '🟡 AMI: CDP READY'
      el.style.background = 'linear-gradient(135deg,#f59e0b,#d97706)'
      el.style.opacity = '0.92'
      return
    }
    if (kind === 'connecting') {
      el.textContent = '🟠 AMI: RECONNECTING…'
      el.style.background = 'linear-gradient(135deg,#f59e0b,#d97706)'
      el.style.opacity = '0.92'
      return
    }
    el.textContent = '🔴 AMI: OFF'
    el.style.background = 'linear-gradient(135deg,#ef4444,#dc2626)'
    el.style.opacity = '0.88'
  }

  // Direct probe from content script context (normal network, no MV3 restrictions)
  async function directProbe() {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 2000)
      // no-cors gives opaque response (status 0) but proves server is reachable
      const res = await fetch('http://127.0.0.1:18800/json/version', {
        signal: ctrl.signal,
        cache: 'no-store',
        mode: 'no-cors',
      })
      clearTimeout(t)
      const cdpOk = true // if fetch didn't throw, server is reachable

      const ctrl2 = new AbortController()
      const t2 = setTimeout(() => ctrl2.abort(), 2000)
      await fetch('http://127.0.0.1:18789/', {
        method: 'HEAD',
        signal: ctrl2.signal,
        cache: 'no-store',
        mode: 'no-cors',
      })
      clearTimeout(t2)
      return 'on' // both reachable
    } catch {
      // Try CDP alone
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 1500)
        await fetch('http://127.0.0.1:18800/json/version', {
          signal: ctrl.signal,
          cache: 'no-store',
          mode: 'no-cors',
        })
        clearTimeout(t)
        return 'cdp-only'
      } catch {
        return 'off'
      }
    }
  }

  async function refresh() {
    // Primary: ask the background service worker
    try {
      chrome.runtime.sendMessage({ type: 'openclaw-monitor-get-status' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          // Background unavailable: fall back to direct probe
          void directProbe().then((kind) => paint(kind))
          return
        }
        const kind = String(res?.kind || 'off')
        if (kind === 'off') {
          // Background says off, but maybe it can't fetch — verify ourselves
          void directProbe().then((directKind) => {
            paint(directKind !== 'off' ? directKind : 'off')
          })
          return
        }
        paint(kind)
      })
    } catch {
      // Extension context invalid: direct probe
      void directProbe().then((kind) => paint(kind))
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'openclaw-relay-status') return
    const kind = String(msg.kind || 'off')
    paint(kind)
  })

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void refresh(), { once: true })
  } else {
    void refresh()
  }

  setInterval(() => void refresh(), 2000)
})()

/* TeachAnAgent — Content Script (injected per tab)
 *
 * Captures DOM events (clicks, inputs, navigation, scroll) and sends
 * them to the background service worker.
 */

;(() => {
  // Guard against double injection
  if (window.__teachAnAgentInstalled) return
  window.__teachAnAgentInstalled = true

  // ── Helpers ──

  const truncate = (s, max = 200) => {
    if (typeof s !== 'string') return s
    return s.length <= max ? s : s.slice(0, max) + '…'
  }

  const isSensitive = (el) => {
    if (!el) return false
    const tag = (el.tagName || '').toLowerCase()
    if (tag !== 'input') return false
    const type = (el.getAttribute('type') || '').toLowerCase()
    return ['password', 'email', 'tel', 'credit-card'].includes(type)
  }

  const cssEsc = (v) => String(v).replace(/([ #;?%&,.+*~\\:'"!^$[\]()=>|/])/g, '\\$1')

  const buildSelector = (el) => {
    try {
      if (!el || el.nodeType !== 1) return null
      if (el.id) return '#' + cssEsc(el.id)

      const parts = []
      let cur = el
      while (cur && cur.nodeType === 1) {
        const tag = (cur.tagName || '').toLowerCase()
        if (!tag) break

        let part = tag
        if (cur.classList && cur.classList.length) {
          part += Array.from(cur.classList)
            .slice(0, 3)
            .map((c) => '.' + cssEsc(c))
            .join('')
        }

        const parent = cur.parentElement
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (c) => (c.tagName || '').toLowerCase() === tag
          )
          if (siblings.length > 1) {
            part += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')'
          }
        }

        parts.unshift(part)
        if (parts.length >= 5) break
        if (tag === 'html' || tag === 'body') break
        cur = parent
      }
      return parts.join(' > ')
    } catch {
      return null
    }
  }

  const elMeta = (el) => {
    if (!el || el.nodeType !== 1) return null
    const tag = (el.tagName || '').toLowerCase()
    return {
      tag,
      id: el.id || undefined,
      role: el.getAttribute('role') || undefined,
      name: el.getAttribute('name') || undefined,
      type: el.getAttribute('type') || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      href: tag === 'a' ? el.getAttribute('href') || undefined : undefined,
      text: truncate((el.innerText || el.textContent || '').trim(), 160) || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      selector: buildSelector(el),
    }
  }

  // ── Send event to background ──

  const send = (event) => {
    try {
      chrome.runtime.sendMessage({
        type: 'teachanagent-event',
        event,
      })
    } catch {
      // Extension context invalidated
    }
  }

  // ── Document ready ──

  send({ type: 'page_load', url: location.href, title: document.title })

  // ── Click ──

  document.addEventListener(
    'click',
    (e) => {
      const meta = elMeta(e.target)
      send({
        type: 'click',
        url: location.href,
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        meta,
      })
    },
    true
  )

  // ── Input / Change ──

  const inputHandler = (e) => {
    const t = e.target
    if (!t || t.nodeType !== 1) return
    const tag = (t.tagName || '').toLowerCase()

    let value
    if (isSensitive(t)) {
      value = '***'
    } else if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      value = truncate(String(t.value ?? ''), 200)
    } else if (t.isContentEditable) {
      value = truncate(String(t.innerText ?? ''), 200)
    }

    send({
      type: 'input',
      url: location.href,
      inputEvent: e.type,
      value,
      meta: elMeta(t),
    })
  }

  document.addEventListener('input', inputHandler, true)
  document.addEventListener('change', inputHandler, true)

  // ── Form submit ──

  document.addEventListener(
    'submit',
    (e) => {
      send({
        type: 'form_submit',
        url: location.href,
        meta: elMeta(e.target),
        action: e.target.action || undefined,
        method: e.target.method || undefined,
      })
    },
    true
  )

  // ── Scroll (throttled) ──

  let scrollTimer = null
  window.addEventListener(
    'scroll',
    () => {
      if (scrollTimer) return
      scrollTimer = setTimeout(() => {
        scrollTimer = null
        send({
          type: 'scroll',
          url: location.href,
          scrollX: Math.round(window.scrollX),
          scrollY: Math.round(window.scrollY),
        })
      }, 500)
    },
    { passive: true }
  )

  // ── Keyboard shortcuts (Ctrl/Cmd + key combos) ──

  document.addEventListener(
    'keydown',
    (e) => {
      // Only log modifier combos and special keys, not every keystroke
      if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') {
        send({
          type: 'keydown',
          url: location.href,
          key: e.key,
          code: e.code,
          ctrl: e.ctrlKey,
          meta: e.metaKey,
          alt: e.altKey,
          shift: e.shiftKey,
          meta_el: elMeta(e.target),
        })
      }
    },
    true
  )

  // ── SPA navigation (pushState / replaceState / popstate) ──

  const notifyRoute = (kind) => {
    send({ type: 'navigation', kind, url: location.href, title: document.title })
  }

  try {
    const origPush = history.pushState
    const origReplace = history.replaceState
    history.pushState = function () {
      const ret = origPush.apply(this, arguments)
      notifyRoute('pushState')
      return ret
    }
    history.replaceState = function () {
      const ret = origReplace.apply(this, arguments)
      notifyRoute('replaceState')
      return ret
    }
  } catch {
    // ignore
  }

  window.addEventListener('popstate', () => notifyRoute('popstate'))
  window.addEventListener('hashchange', () => notifyRoute('hashchange'))

  // ── Before unload ──

  window.addEventListener('beforeunload', () => {
    send({ type: 'page_unload', url: location.href })
  })

  // ── Visual recording indicator ──

  let indicator = null

  function showIndicator() {
    if (indicator) return
    indicator = document.createElement('div')
    indicator.id = 'teachanagent-indicator'
    indicator.innerHTML = '🔴 <span>Recording…</span>'
    Object.assign(indicator.style, {
      position: 'fixed',
      top: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '12px',
      fontWeight: '700',
      padding: '6px 14px',
      borderRadius: '999px',
      background: 'rgba(239,68,68,0.92)',
      color: '#fff',
      boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
      pointerEvents: 'none',
      userSelect: 'none',
      letterSpacing: '.3px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      animation: 'teachanagent-pulse 1.5s ease-in-out infinite',
    })

    const style = document.createElement('style')
    style.textContent = `
      @keyframes teachanagent-pulse {
        0%, 100% { opacity: 0.92; }
        50% { opacity: 0.6; }
      }
    `
    document.documentElement.appendChild(style)
    document.documentElement.appendChild(indicator)
  }

  function hideIndicator() {
    if (indicator) {
      indicator.remove()
      indicator = null
    }
  }

  function updateIndicator(newState) {
    if (newState === 'recording') {
      showIndicator()
      if (indicator) {
        indicator.innerHTML = '🔴 <span>Recording…</span>'
        indicator.style.background = 'rgba(239,68,68,0.92)'
      }
    } else if (newState === 'paused') {
      showIndicator()
      if (indicator) {
        indicator.innerHTML = '⏸️ <span>Paused</span>'
        indicator.style.background = 'rgba(245,158,11,0.92)'
        indicator.style.animation = 'none'
      }
    } else {
      hideIndicator()
    }
  }

  // Listen for state changes from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'teachanagent-state') {
      updateIndicator(msg.state)
    }
  })

  // Check initial state
  try {
    chrome.runtime.sendMessage({ type: 'teachanagent-get-state' }, (res) => {
      if (chrome.runtime.lastError) return
      if (res && res.state) updateIndicator(res.state)
    })
  } catch {
    // ignore
  }
})()

const DEFAULT_PORT = 18792
const DEFAULT_AUTO_ATTACH = true
const RELAY_SWEEP_ALARM = 'relay-auto-attach-sweep'
const RELAY_SWEEP_MINUTES = 0.05

// AMI Browser: prefer monitoring via direct CDP (stable across navigations)
const DIRECT_CDP_VERSION_URL = 'http://127.0.0.1:18800/json/version'
const GATEWAY_ROOT_URL = 'http://127.0.0.1:18789/'

const BADGE = {
  on: { text: 'ON', color: '#FF5A36' },
  off: { text: '', color: '#000000' },
  connecting: { text: '…', color: '#F59E0B' },
  error: { text: '!', color: '#B91C1C' },
}

/** @type {WebSocket|null} */
let relayWs = null
/** @type {Promise<void>|null} */
let relayConnectPromise = null

let debuggerListenersInstalled = false

let nextSession = 1

/** @type {Map<number, {state:'connecting'|'connected', startedAt?:number, sessionId?:string, targetId?:string, attachOrder?:number}>} */
const tabs = new Map()
/** @type {Map<string, number>} */
const tabBySession = new Map()
/** @type {Map<string, number>} */
const childSessionToTab = new Map()

/** @type {Map<number, {resolve:(v:any)=>void, reject:(e:Error)=>void}>} */
const pending = new Map()
/** @type {Set<number>} */
const manualDetachTabs = new Set()

function nowStack() {
  try {
    return new Error().stack || ''
  } catch {
    return ''
  }
}

async function fetchOk(url, { method = 'GET', timeoutMs = 1500 } = {}) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      cache: 'no-store',
      mode: 'no-cors',
    })
    clearTimeout(t)
    // With mode:'no-cors' an opaque response has type 'opaque' and status 0,
    // but it means the server IS reachable.
    if (res.type === 'opaque') {
      console.log('[AMI Relay] fetchOk', url, '→ opaque (reachable)')
      return true
    }
    const ok = Boolean(res && res.ok)
    console.log('[AMI Relay] fetchOk', url, '→', res.status, ok)
    return ok
  } catch (err) {
    console.warn('[AMI Relay] fetchOk FAILED', url, String(err))
    return false
  }
}

async function updateMonitorBadge(tabId, source) {
  if (!tabId) return
  // CDP should stay up even when a tab navigates/redirects.
  const cdpOk = await fetchOk(DIRECT_CDP_VERSION_URL, { method: 'GET', timeoutMs: 1500 })
  const gwOk = await fetchOk(GATEWAY_ROOT_URL, { method: 'HEAD', timeoutMs: 1500 })

  if (cdpOk) {
    // When gateway is reachable, we are fully ready. If not, CDP is still usable.
    setBadge(tabId, gwOk ? 'on' : 'connecting')
    publishTabStatus(tabId, gwOk ? 'on' : 'cdp-only', source)
    void chrome.action.setTitle({
      tabId,
      title: gwOk
        ? `AMI Relay: listening (CDP+gateway ok) [${source}]`
        : `AMI Relay: CDP ready (gateway unreachable) [${source}]`,
    })
    return
  }

  setBadge(tabId, 'off')
  publishTabStatus(tabId, 'off', source)
  void chrome.action.setTitle({
    tabId,
    title: `AMI Relay: CDP not reachable (is AMI Browser running?) [${source}]`,
  })
}

async function refreshAllMonitorBadges(source) {
  const allTabs = await chrome.tabs.query({})
  for (const tab of allTabs) {
    if (!tab.id) continue
    void updateMonitorBadge(tab.id, source)
  }
}

async function getRelayPort() {
  const stored = await chrome.storage.local.get(['relayPort'])
  const raw = stored.relayPort
  const n = Number.parseInt(String(raw || ''), 10)
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return DEFAULT_PORT
  return n
}

async function getAutoAttachEnabled() {
  const stored = await chrome.storage.local.get(['relayAutoAttach'])
  const raw = stored.relayAutoAttach
  if (raw === undefined) return DEFAULT_AUTO_ATTACH
  return raw !== false
}

function isAttachableTabUrl(url) {
  const value = String(url || '').trim().toLowerCase()
  if (!value) return false
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('file://') ||
    value.startsWith('about:blank')
  )
}

async function isDebuggerAttachedToTab(tabId) {
  try {
    const targets = await chrome.debugger.getTargets()
    return targets.some((target) => target.tabId === tabId && target.attached)
  } catch {
    return false
  }
}

async function syncBadgeFromDebugger(tabId) {
  if (!tabId) return false
  const attached = await isDebuggerAttachedToTab(tabId)
  if (!attached) return false
  setBadge(tabId, 'on')
  void chrome.action.setTitle({
    tabId,
    title: 'AMI Relay: attached (click to detach)',
  })
  return true
}

async function maybeAutoAttachTab(tabId, source) {
  if (!tabId) return
  if (!(await getAutoAttachEnabled())) return

  const existing = tabs.get(tabId)
  const alreadyAttached = await isDebuggerAttachedToTab(tabId)

  if (!existing && alreadyAttached) {
    // MV3 worker wake-up can lose local state while debugger is still attached.
    // Recreate a clean relay session so forwarding and badge stay consistent.
    await syncBadgeFromDebugger(tabId)
    await chrome.debugger.detach({ tabId }).catch(() => {})
    await new Promise((r) => setTimeout(r, 80))
  }

  if (existing?.state === 'connected') {
    if (alreadyAttached) {
      await syncBadgeFromDebugger(tabId)
      return
    }
    // In-memory state can drift after navigation/process swaps.
    tabs.delete(tabId)
  }
  if (existing?.state === 'connecting') {
    const startedAt = Number(existing.startedAt || 0)
    if (startedAt > 0 && Date.now() - startedAt < 5000) {
      return
    }
    tabs.delete(tabId)
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (!tab || !isAttachableTabUrl(tab.url)) return

  tabs.set(tabId, { state: 'connecting', startedAt: Date.now() })
  setBadge(tabId, 'connecting')
  void chrome.action.setTitle({
    tabId,
    title: `AMI Relay: auto-connecting (${source})…`,
  })

  try {
    await ensureRelayConnection()
    try {
      await attachTab(tabId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.toLowerCase().includes('another debugger is already attached')) {
        await chrome.debugger.detach({ tabId }).catch(() => {})
        await new Promise((r) => setTimeout(r, 80))
        await attachTab(tabId)
      } else {
        throw err
      }
    }
  } catch (err) {
    tabs.delete(tabId)
    const transientSource = String(source || '').includes('detached:') || String(source || '').includes('updated')
    if (transientSource) {
      setBadge(tabId, 'on')
      void chrome.action.setTitle({
        tabId,
        title: 'AMI Relay: reconnecting…',
      })
      scheduleAttachRetries(tabId, `recover:${String(source || 'auto')}`, 6, 600)
    } else {
      setBadge(tabId, 'error')
      void chrome.action.setTitle({
        tabId,
        title: 'AMI Relay: auto-attach failed (open options)',
      })
    }
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`auto-attach failed [${source}]`, message, nowStack())
  }
}

async function sweepAttachableTabs(source) {
  if (!(await getAutoAttachEnabled())) return
  const allTabs = await chrome.tabs.query({})
  for (const tab of allTabs) {
    const id = tab.id
    if (!id) continue
    if (!isAttachableTabUrl(tab.url)) continue
    void maybeAutoAttachTab(id, source)
  }
}

function scheduleAttachRetries(tabId, source, attempts = 8, intervalMs = 400) {
  for (let i = 0; i < attempts; i++) {
    setTimeout(() => {
      void maybeAutoAttachTab(tabId, `${source}-retry-${i + 1}`)
    }, i * intervalMs)
  }
}

function ensureSweepAlarm() {
  chrome.alarms.create(RELAY_SWEEP_ALARM, {
    delayInMinutes: 0.05,
    periodInMinutes: RELAY_SWEEP_MINUTES,
  })
}

function publishTabStatus(tabId, kind, detail = '') {
  if (!tabId) return
  void chrome.tabs
    .sendMessage(tabId, {
      type: 'openclaw-relay-status',
      kind,
      detail,
      ts: Date.now(),
    })
    .catch(() => {})
}

function setBadge(tabId, kind) {
  const cfg = BADGE[kind]
  void chrome.action.setBadgeText({ tabId, text: cfg.text })
  void chrome.action.setBadgeBackgroundColor({ tabId, color: cfg.color })
  void chrome.action.setBadgeTextColor({ tabId, color: '#FFFFFF' }).catch(() => {})
  publishTabStatus(tabId, kind)
}

async function ensureRelayConnection() {
  if (relayWs && relayWs.readyState === WebSocket.OPEN) return
  if (relayConnectPromise) return await relayConnectPromise

  relayConnectPromise = (async () => {
    const port = await getRelayPort()
    const httpBase = `http://127.0.0.1:${port}`
    const wsUrl = `ws://127.0.0.1:${port}/extension`

    // Fast preflight: is the relay server up?
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 2000)
      await fetch(`${httpBase}/`, { method: 'HEAD', signal: ctrl.signal, mode: 'no-cors', cache: 'no-store' })
      clearTimeout(t)
    } catch (err) {
      throw new Error(`Relay server not reachable at ${httpBase} (${String(err)})`)
    }

    const ws = new WebSocket(wsUrl)
    relayWs = ws

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000)
      ws.onopen = () => {
        clearTimeout(t)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(t)
        reject(new Error('WebSocket connect failed'))
      }
      ws.onclose = (ev) => {
        clearTimeout(t)
        reject(new Error(`WebSocket closed (${ev.code} ${ev.reason || 'no reason'})`))
      }
    })

    ws.onmessage = (event) => void onRelayMessage(String(event.data || ''))
    ws.onclose = () => onRelayClosed('closed')
    ws.onerror = () => onRelayClosed('error')

    // As soon as relay is online, aggressively attach all eligible tabs.
    void sweepAttachableTabs('relay-open')

    if (!debuggerListenersInstalled) {
      debuggerListenersInstalled = true
      chrome.debugger.onEvent.addListener(onDebuggerEvent)
      chrome.debugger.onDetach.addListener(onDebuggerDetach)
    }
  })()

  try {
    await relayConnectPromise
  } finally {
    relayConnectPromise = null
  }
}

function onRelayClosed(reason) {
  relayWs = null
  for (const [id, p] of pending.entries()) {
    pending.delete(id)
    p.reject(new Error(`Relay disconnected (${reason})`))
  }

  for (const tabId of tabs.keys()) {
    void chrome.debugger.detach({ tabId }).catch(() => {})
    setBadge(tabId, 'connecting')
    publishTabStatus(tabId, 'connecting', 'relay-disconnected')
    void chrome.action.setTitle({
      tabId,
      title: 'AMI Relay: disconnected (click to re-attach)',
    })
  }
  tabs.clear()
  tabBySession.clear()
  childSessionToTab.clear()
  void sweepAttachableTabs(`relay-${reason}`)
}

function sendToRelay(payload) {
  const ws = relayWs
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Relay not connected')
  }
  ws.send(JSON.stringify(payload))
}

async function maybeOpenHelpOnce() {
  try {
    const stored = await chrome.storage.local.get(['helpOnErrorShown'])
    if (stored.helpOnErrorShown === true) return
    await chrome.storage.local.set({ helpOnErrorShown: true })
    // Do not hijack startup by opening options automatically.
    // Users can open options manually from the extension menu.
    console.warn('Relay attach failed; options page not auto-opened.')
  } catch {
    // ignore
  }
}

function requestFromRelay(command) {
  const id = command.id
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try {
      sendToRelay(command)
    } catch (err) {
      pending.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

async function onRelayMessage(text) {
  /** @type {any} */
  let msg
  try {
    msg = JSON.parse(text)
  } catch {
    return
  }

  if (msg && msg.method === 'ping') {
    try {
      sendToRelay({ method: 'pong' })
    } catch {
      // ignore
    }
    return
  }

  if (msg && typeof msg.id === 'number' && (msg.result !== undefined || msg.error !== undefined)) {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(String(msg.error)))
    else p.resolve(msg.result)
    return
  }

  if (msg && typeof msg.id === 'number' && msg.method === 'forwardCDPCommand') {
    try {
      const result = await handleForwardCdpCommand(msg)
      sendToRelay({ id: msg.id, result })
    } catch (err) {
      sendToRelay({ id: msg.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
}

function getTabBySessionId(sessionId) {
  const direct = tabBySession.get(sessionId)
  if (direct) return { tabId: direct, kind: 'main' }
  const child = childSessionToTab.get(sessionId)
  if (child) return { tabId: child, kind: 'child' }
  return null
}

function getTabByTargetId(targetId) {
  for (const [tabId, tab] of tabs.entries()) {
    if (tab.targetId === targetId) return tabId
  }
  return null
}

async function attachTab(tabId, opts = {}) {
  const debuggee = { tabId }
  await chrome.debugger.attach(debuggee, '1.3')
  await chrome.debugger.sendCommand(debuggee, 'Page.enable').catch(() => {})

  const info = /** @type {any} */ (await chrome.debugger.sendCommand(debuggee, 'Target.getTargetInfo'))
  const targetInfo = info?.targetInfo
  const targetId = String(targetInfo?.targetId || '').trim()
  if (!targetId) {
    throw new Error('Target.getTargetInfo returned no targetId')
  }

  const sessionId = `cb-tab-${nextSession++}`
  const attachOrder = nextSession

  tabs.set(tabId, { state: 'connected', sessionId, targetId, attachOrder })
  tabBySession.set(sessionId, tabId)
  void chrome.action.setTitle({
    tabId,
    title: 'AMI Relay: attached (click to detach)',
  })

  if (!opts.skipAttachedEvent) {
    sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.attachedToTarget',
        params: {
          sessionId,
          targetInfo: { ...targetInfo, attached: true },
          waitingForDebugger: false,
        },
      },
    })
  }

  setBadge(tabId, 'on')
  return { sessionId, targetId }
}

async function detachTab(tabId, reason) {
  if (reason === 'toggle') {
    manualDetachTabs.add(tabId)
  }

  const tab = tabs.get(tabId)
  if (tab?.sessionId && tab?.targetId) {
    try {
      sendToRelay({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.detachedFromTarget',
          params: { sessionId: tab.sessionId, targetId: tab.targetId, reason },
        },
      })
    } catch {
      // ignore
    }
  }

  if (tab?.sessionId) tabBySession.delete(tab.sessionId)
  tabs.delete(tabId)

  for (const [childSessionId, parentTabId] of childSessionToTab.entries()) {
    if (parentTabId === tabId) childSessionToTab.delete(childSessionId)
  }

  try {
    await chrome.debugger.detach({ tabId })
  } catch {
    // ignore
  }

  if (reason === 'toggle') {
    setBadge(tabId, 'off')
    void chrome.action.setTitle({
      tabId,
      title: 'AMI Relay (click to attach/detach)',
    })
  } else {
    setBadge(tabId, 'on')
    void chrome.action.setTitle({
      tabId,
      title: 'AMI Relay: reconnecting…',
    })
  }
}

async function connectOrToggleForActiveTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  const tabId = active?.id
  if (!tabId) return

  const existing = tabs.get(tabId)
  if (existing?.state === 'connected') {
    await detachTab(tabId, 'toggle')
    return
  }

  tabs.set(tabId, { state: 'connecting', startedAt: Date.now() })
  setBadge(tabId, 'connecting')
  void chrome.action.setTitle({
    tabId,
    title: 'AMI Relay: connecting to local relay…',
  })

  try {
    await ensureRelayConnection()
    await attachTab(tabId)
  } catch (err) {
    tabs.delete(tabId)
    setBadge(tabId, 'error')
    void chrome.action.setTitle({
      tabId,
      title: 'AMI Relay: relay not running (open options for setup)',
    })
    void maybeOpenHelpOnce()
    // Extra breadcrumbs in chrome://extensions service worker logs.
    const message = err instanceof Error ? err.message : String(err)
    console.warn('attach failed', message, nowStack())
  }
}

async function handleForwardCdpCommand(msg) {
  const method = String(msg?.params?.method || '').trim()
  const params = msg?.params?.params || undefined
  const sessionId = typeof msg?.params?.sessionId === 'string' ? msg.params.sessionId : undefined

  // Map command to tab
  const bySession = sessionId ? getTabBySessionId(sessionId) : null
  const targetId = typeof params?.targetId === 'string' ? params.targetId : undefined
  const tabId =
    bySession?.tabId ||
    (targetId ? getTabByTargetId(targetId) : null) ||
    (() => {
      // No sessionId: pick the first connected tab (stable-ish).
      for (const [id, tab] of tabs.entries()) {
        if (tab.state === 'connected') return id
      }
      return null
    })()

  if (!tabId) throw new Error(`No attached tab for method ${method}`)

  /** @type {chrome.debugger.DebuggerSession} */
  const debuggee = { tabId }

  if (method === 'Runtime.enable') {
    try {
      await chrome.debugger.sendCommand(debuggee, 'Runtime.disable')
      await new Promise((r) => setTimeout(r, 50))
    } catch {
      // ignore
    }
    return await chrome.debugger.sendCommand(debuggee, 'Runtime.enable', params)
  }

  if (method === 'Target.createTarget') {
    const url = typeof params?.url === 'string' ? params.url : 'about:blank'
    const tab = await chrome.tabs.create({ url, active: false })
    if (!tab.id) throw new Error('Failed to create tab')
    await new Promise((r) => setTimeout(r, 100))
    const attached = await attachTab(tab.id)
    return { targetId: attached.targetId }
  }

  if (method === 'Target.closeTarget') {
    const target = typeof params?.targetId === 'string' ? params.targetId : ''
    const toClose = target ? getTabByTargetId(target) : tabId
    if (!toClose) return { success: false }
    try {
      await chrome.tabs.remove(toClose)
    } catch {
      return { success: false }
    }
    return { success: true }
  }

  if (method === 'Target.activateTarget') {
    const target = typeof params?.targetId === 'string' ? params.targetId : ''
    const toActivate = target ? getTabByTargetId(target) : tabId
    if (!toActivate) return {}
    const tab = await chrome.tabs.get(toActivate).catch(() => null)
    if (!tab) return {}
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {})
    }
    await chrome.tabs.update(toActivate, { active: true }).catch(() => {})
    return {}
  }

  const tabState = tabs.get(tabId)
  const mainSessionId = tabState?.sessionId
  const debuggerSession =
    sessionId && mainSessionId && sessionId !== mainSessionId
      ? { ...debuggee, sessionId }
      : debuggee

  return await chrome.debugger.sendCommand(debuggerSession, method, params)
}

function onDebuggerEvent(source, method, params) {
  const tabId = source.tabId
  if (!tabId) return
  const tab = tabs.get(tabId)
  if (!tab?.sessionId) return

  if (method === 'Target.attachedToTarget' && params?.sessionId) {
    childSessionToTab.set(String(params.sessionId), tabId)
  }

  if (method === 'Target.detachedFromTarget' && params?.sessionId) {
    childSessionToTab.delete(String(params.sessionId))
  }

  try {
    sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        sessionId: source.sessionId || tab.sessionId,
        method,
        params,
      },
    })
  } catch {
    // ignore
  }
}

function onDebuggerDetach(source, reason) {
  const tabId = source.tabId
  if (!tabId) return

  if (manualDetachTabs.has(tabId)) {
    manualDetachTabs.delete(tabId)
    return
  }

  void detachTab(tabId, reason).then(() => {
    // Navigation/process swaps can detach debugger sessions.
    // Re-attach quickly to keep relay ON across all pages/tabs.
    scheduleAttachRetries(tabId, `detached:${String(reason || 'unknown')}`)
  })
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'openclaw-monitor-ping') {
    const tabId = sender.tab?.id
    if (tabId) {
      void updateMonitorBadge(tabId, 'ping')
    }
    sendResponse({ ok: true })
    return
  }

  if (msg && msg.type === 'openclaw-monitor-get-status') {
    const tabId = sender.tab?.id
    void (async () => {
      const cdpOk = await fetchOk(DIRECT_CDP_VERSION_URL, { method: 'GET', timeoutMs: 1500 })
      const gwOk = await fetchOk(GATEWAY_ROOT_URL, { method: 'HEAD', timeoutMs: 1500 })
      const kind = cdpOk ? (gwOk ? 'on' : 'cdp-only') : 'off'
      if (tabId) {
        publishTabStatus(tabId, kind, 'get-status')
      }
      sendResponse({ ok: true, kind, cdpOk, gwOk })
    })()
    return true
  }

  if (!msg || msg.type !== 'openclaw-relay-get-status') return
  const tabId = sender.tab?.id
  if (!tabId) {
    sendResponse({ ok: false, kind: 'off' })
    return
  }

  void (async () => {
    const attached = await isDebuggerAttachedToTab(tabId)
    const tracked = tabs.get(tabId)
    const kind = attached || tracked?.state === 'connected' ? 'on' : tracked?.state === 'connecting' ? 'connecting' : 'off'
    sendResponse({ ok: true, kind })
  })()

  return true
})

chrome.action.onClicked.addListener(() => void connectOrToggleForActiveTab())

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void syncBadgeFromDebugger(tabId)
  void updateMonitorBadge(tabId, 'activated')
  void maybeAutoAttachTab(tabId, 'activated')
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void syncBadgeFromDebugger(tabId)
  void updateMonitorBadge(tabId, 'updated')
  if (changeInfo.status === 'complete' || changeInfo.status === 'loading' || changeInfo.url) {
    void maybeAutoAttachTab(tabId, 'updated')
  }
})

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return
  const tabId = details.tabId
  if (!tabId) return
  void syncBadgeFromDebugger(tabId)
  void updateMonitorBadge(tabId, 'nav-committed')
  void maybeAutoAttachTab(tabId, 'nav-committed')
})

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return
  const tabId = details.tabId
  if (!tabId) return
  void syncBadgeFromDebugger(tabId)
  void updateMonitorBadge(tabId, 'nav-history')
  void maybeAutoAttachTab(tabId, 'nav-history')
})

chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => {
  if (details.frameId !== 0) return
  const tabId = details.tabId
  if (!tabId) return
  void syncBadgeFromDebugger(tabId)
  void updateMonitorBadge(tabId, 'nav-fragment')
  void maybeAutoAttachTab(tabId, 'nav-fragment')
})

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) {
    void updateMonitorBadge(tab.id, 'created')
    void maybeAutoAttachTab(tab.id, 'created')
  }
})

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (tabs.has(removedTabId)) {
    void detachTab(removedTabId, 'replaced')
  }
  void updateMonitorBadge(addedTabId, 'replaced')
  void maybeAutoAttachTab(addedTabId, 'replaced')
})

chrome.tabs.onRemoved.addListener((tabId) => {
  const tab = tabs.get(tabId)
  if (tab?.sessionId) tabBySession.delete(tab.sessionId)
  tabs.delete(tabId)
  for (const [childSessionId, parentTabId] of childSessionToTab.entries()) {
    if (parentTabId === tabId) childSessionToTab.delete(childSessionId)
  }
})

// ── Auto-close browser's unwanted options.html tab ───────────────
// Browser often auto-opens options.html for unpacked extensions.
// We close it from multiple hooks to be reliable regardless of timing.
const OPT_GUARD_MS = 8000          // watch window after boot
const optBootTime = Date.now()

async function closeOptionsTabs() {
  try {
    const optUrl = chrome.runtime.getURL('options.html')
    const optTabs = await chrome.tabs.query({ url: optUrl })
    for (const t of optTabs) {
      await chrome.tabs.remove(t.id).catch(() => {})
    }
    // If we just closed the only tab, open a new tab so the user isn't
    // left with an empty window.
    if (optTabs.length > 0) {
      const remaining = await chrome.tabs.query({})
      if (remaining.length === 0) {
        await chrome.tabs.create({ url: 'chrome://newtab' })
      }
    }
  } catch (_) { /* ignore */ }
}

// Watch for the options tab being created during the startup window.
chrome.tabs.onCreated.addListener((tab) => {
  if (Date.now() - optBootTime > OPT_GUARD_MS) return
  // New tabs may not have a URL yet; check on update.
})
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (Date.now() - optBootTime > OPT_GUARD_MS) return
  if (changeInfo.url && changeInfo.url.includes('/options.html')) {
    chrome.tabs.remove(tabId).catch(() => {})
  }
})

chrome.runtime.onInstalled.addListener(() => {
  ensureSweepAlarm()
  void refreshAllMonitorBadges('installed')
  void chrome.storage.local.get(['relayAutoAttach']).then((stored) => {
    if (stored.relayAutoAttach === undefined) {
      return chrome.storage.local.set({ relayAutoAttach: DEFAULT_AUTO_ATTACH })
    }
  })
  void sweepAttachableTabs('installed')
  void closeOptionsTabs()

  // Context menu to open settings (since options_ui was removed)
  chrome.contextMenus.create({
    id: 'ami-relay-settings',
    title: 'AMI Relay Settings',
    contexts: ['action'],
  })
})

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'ami-relay-settings') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })
  }
})

chrome.runtime.onStartup.addListener(async () => {
  ensureSweepAlarm()
  void refreshAllMonitorBadges('startup')
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (active?.id) {
    void maybeAutoAttachTab(active.id, 'startup')
  }
  void sweepAttachableTabs('startup')
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RELAY_SWEEP_ALARM) return
  void sweepAttachableTabs('alarm')
})

// Service workers are ephemeral in MV3. Re-prime auto-attach on each wake.
ensureSweepAlarm()
void refreshAllMonitorBadges('boot')
void sweepAttachableTabs('boot')
// Close options.html on every service-worker boot (covers timing gaps).
void closeOptionsTabs()

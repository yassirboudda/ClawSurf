/* TeachAnAgent — Background Service Worker v2.0
 *
 * Manages recording state and aggregates events from content scripts.
 * State machine: idle → recording → (paused ↔ recording) → idle
 *
 * v2.0 — Crash-proof persistence:
 *   - Events saved in small chunks to chrome.storage.local (never one giant blob)
 *   - Keep-alive alarm prevents service worker idle termination (~24s tick)
 *   - Keeps 2 most recent session archives: when a 3rd starts, oldest is deleted
 *   - On crash/restart, restores in-progress session from chunks automatically
 */

const SESSION_META_KEY = 'taa-meta'       // small JSON: state, sessionId, chunkIndex, etc.
const ARCHIVE_KEY = 'taa-archives'        // array of {sessionId, startedAt, endedAt, eventCount, chunkCount}
const CHUNK_SIZE = 50                     // events per storage write
const MAX_ARCHIVES = 2                    // keep N most recent finished sessions
const KEEPALIVE_ALARM = 'taa-keepalive'

let state = 'idle'
let events = []          // in-memory buffer (full current session)
let sessionId = null
let sessionStartedAt = null
let chunkIndex = 0       // next chunk slot to write
let savedUpTo = 0        // how many events have been persisted in chunks

// ── Storage key helpers ──

function chunkKey(sid, idx) {
  return `taa-c-${sid}-${idx}`
}

function genId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
}

// ── State snapshot (for popup / content scripts) ──

function getState() {
  return { state, eventCount: events.length, sessionStartedAt, sessionId }
}

// ── Persist lightweight metadata (no events) ──

async function persistMeta() {
  try {
    await chrome.storage.local.set({
      [SESSION_META_KEY]: {
        state,
        sessionId,
        sessionStartedAt,
        chunkIndex,
        totalEvents: events.length,
      },
    })
  } catch (err) {
    console.warn('[TAA] persistMeta error:', err)
  }
}

// ── Flush unsaved events to a new chunk ──

async function flushChunk() {
  if (!sessionId || savedUpTo >= events.length) return
  const batch = events.slice(savedUpTo)
  const key = chunkKey(sessionId, chunkIndex)
  try {
    await chrome.storage.local.set({ [key]: batch })
    savedUpTo = events.length
    chunkIndex++
    await persistMeta()
    console.log(`[TAA] Chunk ${key}: +${batch.length} events (total ${events.length})`)
  } catch (err) {
    console.warn('[TAA] flushChunk error:', err)
  }
}

// ── Auto-flush when unsaved buffer hits CHUNK_SIZE ──

async function maybeFlush() {
  if (events.length - savedUpTo >= CHUNK_SIZE) {
    await flushChunk()
  }
}

// ── Load all chunks for a given session ID → event array ──

async function loadSessionEvents(sid) {
  const out = []
  let i = 0
  while (true) {
    const key = chunkKey(sid, i)
    const data = await chrome.storage.local.get([key])
    if (!data[key] || !Array.isArray(data[key]) || data[key].length === 0) break
    out.push(...data[key])
    i++
  }
  return out
}

// ── Delete all chunks for a session ID ──

async function deleteChunks(sid) {
  const keys = []
  let i = 0
  while (true) {
    const key = chunkKey(sid, i)
    const data = await chrome.storage.local.get([key])
    if (!data[key]) break
    keys.push(key)
    i++
  }
  if (keys.length) {
    await chrome.storage.local.remove(keys)
    console.log(`[TAA] Deleted ${keys.length} chunks for ${sid}`)
  }
}

// ── Archive helpers ──

async function getArchives() {
  const d = await chrome.storage.local.get([ARCHIVE_KEY])
  return d[ARCHIVE_KEY] || []
}

async function saveArchives(list) {
  await chrome.storage.local.set({ [ARCHIVE_KEY]: list })
}

/* Move the current session into the archive list and trim to MAX_ARCHIVES. */
async function archiveCurrent() {
  if (!sessionId || events.length === 0) return

  // Make sure every event is on disk
  await flushChunk()

  const archives = await getArchives()
  archives.push({
    sessionId,
    startedAt: sessionStartedAt,
    endedAt: new Date().toISOString(),
    eventCount: events.length,
    chunkCount: chunkIndex,
  })

  // Evict oldest beyond MAX_ARCHIVES
  while (archives.length > MAX_ARCHIVES) {
    const old = archives.shift()
    await deleteChunks(old.sessionId)
    console.log(`[TAA] Evicted oldest archive: ${old.sessionId}`)
  }

  await saveArchives(archives)
  console.log(`[TAA] Archived ${sessionId} (${events.length} events). Archives: ${archives.length}`)
}

// ── Restore in-flight session after service-worker restart ──

async function restoreSession() {
  try {
    const d = await chrome.storage.local.get([SESSION_META_KEY])
    const meta = d[SESSION_META_KEY]
    if (!meta || !meta.sessionId) return

    // Reload all persisted chunks into memory
    const loaded = await loadSessionEvents(meta.sessionId)

    state = meta.state || 'idle'
    sessionId = meta.sessionId
    sessionStartedAt = meta.sessionStartedAt
    chunkIndex = meta.chunkIndex || 0
    events = loaded
    savedUpTo = loaded.length

    console.log(`[TAA] Restored session ${sessionId}: ${events.length} events, state=${state}`)
  } catch (err) {
    console.warn('[TAA] restoreSession error:', err)
  }
}

// ── Keep-alive alarm (prevents MV3 service-worker idle kill) ──

function startKeepalive() {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 }) // ~24 s
}

function stopKeepalive() {
  chrome.alarms.clear(KEEPALIVE_ALARM)
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return
  if (state === 'recording' || state === 'paused') {
    // Flush any pending events on each tick to keep data safe
    await maybeFlush()
  } else {
    stopKeepalive()
  }
})

// ── Recording controls ──

async function startRecording() {
  // If there's an active session with events, archive it first
  if (sessionId && events.length > 0) {
    await archiveCurrent()
  }

  // Fresh session
  sessionId = genId()
  sessionStartedAt = new Date().toISOString()
  events = []
  chunkIndex = 0
  savedUpTo = 0
  state = 'recording'

  events.push({ ts: sessionStartedAt, type: 'session_start' })
  await persistMeta()
  startKeepalive()
  broadcastState()
  console.log(`[TAA] Recording started: ${sessionId}`)
}

async function pauseRecording() {
  if (state !== 'recording') return
  state = 'paused'
  events.push({ ts: new Date().toISOString(), type: 'recording_paused' })
  await flushChunk() // save immediately on pause
  broadcastState()
}

async function resumeRecording() {
  if (state !== 'paused') return
  state = 'recording'
  events.push({ ts: new Date().toISOString(), type: 'recording_resumed' })
  await persistMeta()
  startKeepalive()
  broadcastState()
}

async function stopRecording() {
  if (state === 'idle') return
  events.push({ ts: new Date().toISOString(), type: 'session_end' })
  state = 'idle'

  await archiveCurrent()
  await persistMeta()
  stopKeepalive()
  broadcastState()
  console.log(`[TAA] Stopped: ${sessionId} (${events.length} events)`)
}

function getEvents() {
  return events
}

// ── Badge ──

const BADGE = {
  idle: { text: '', color: '#666666' },
  recording: { text: 'REC', color: '#EF4444' },
  paused: { text: '❚❚', color: '#F59E0B' },
}

function updateBadge() {
  const cfg = BADGE[state] || BADGE.idle
  chrome.action.setBadgeText({ text: cfg.text })
  chrome.action.setBadgeBackgroundColor({ color: cfg.color })
  try {
    chrome.action.setBadgeTextColor({ color: '#FFFFFF' })
  } catch {
    // older Chrome
  }
}

// ── Broadcast state to popup + content scripts ──

function broadcastState() {
  updateBadge()
  const msg = { type: 'teachanagent-state', ...getState() }
  chrome.runtime.sendMessage(msg).catch(() => {})
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) chrome.tabs.sendMessage(tab.id, msg).catch(() => {})
    }
  })
}

// ── Inject content script into a tab ──

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-recorder.js'],
    })
  } catch {
    // Tab may not be injectable (chrome://, etc.)
  }
}

function injectIntoAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
        injectContentScript(tab.id)
      }
    }
  })
}

// ── Message handler ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return

  switch (msg.type) {
    case 'teachanagent-get-state':
      sendResponse(getState())
      return

    case 'teachanagent-start':
      startRecording().then(() => {
        injectIntoAllTabs()
        sendResponse(getState())
      })
      return true // async

    case 'teachanagent-pause':
      pauseRecording().then(() => sendResponse(getState()))
      return true

    case 'teachanagent-resume':
      resumeRecording().then(() => {
        injectIntoAllTabs()
        sendResponse(getState())
      })
      return true

    case 'teachanagent-stop':
      stopRecording().then(() => sendResponse(getState()))
      return true

    case 'teachanagent-get-events':
      sendResponse({ events: getEvents() })
      return

    case 'teachanagent-get-archives':
      getArchives().then((archives) => sendResponse({ archives }))
      return true

    case 'teachanagent-get-archived-events': {
      const sid = msg.sessionId
      if (!sid) { sendResponse({ events: [] }); return }
      loadSessionEvents(sid).then((evts) => sendResponse({ events: evts }))
      return true
    }

    case 'teachanagent-event': {
      if (state !== 'recording') return
      const event = msg.event
      if (event) {
        event.ts = event.ts || new Date().toISOString()
        if (sender.tab) {
          event.tabId = sender.tab.id
          event.tabUrl = sender.tab.url || event.url
        }
        events.push(event)
        maybeFlush().catch(() => {})
        chrome.runtime
          .sendMessage({ type: 'teachanagent-event-count', eventCount: events.length })
          .catch(() => {})
      }
      return
    }
  }
})

// Allow AMI Hub extension to read recorder status safely.
chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return

  switch (msg.type) {
    case 'teachanagent-get-state':
      sendResponse(getState())
      return
    case 'teachanagent-get-events':
      sendResponse({ events: getEvents() })
      return
  }
})

// ── Auto-inject on new tabs while recording ──

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if ((state === 'recording' || state === 'paused') && changeInfo.status === 'complete') {
    injectContentScript(tabId)
  }
})

chrome.tabs.onCreated.addListener((tab) => {
  if ((state === 'recording' || state === 'paused') && tab.id) {
    setTimeout(() => injectContentScript(tab.id), 300)
  }
})

// ── Migrate old storage format (v1 → v2) ──
// If the old key exists, archive its events then remove it.

async function migrateV1() {
  const OLD_KEY = 'teachanagent-session'
  try {
    const d = await chrome.storage.local.get([OLD_KEY])
    const old = d[OLD_KEY]
    if (!old || !Array.isArray(old.events) || old.events.length === 0) return

    // Write old events as a single chunk under a synthetic session ID
    const sid = 'migrated-' + genId()
    await chrome.storage.local.set({ [chunkKey(sid, 0)]: old.events })
    const archives = await getArchives()
    archives.push({
      sessionId: sid,
      startedAt: old.sessionStartedAt || new Date().toISOString(),
      endedAt: new Date().toISOString(),
      eventCount: old.events.length,
      chunkCount: 1,
    })
    // Trim
    while (archives.length > MAX_ARCHIVES) {
      const oldest = archives.shift()
      await deleteChunks(oldest.sessionId)
    }
    await saveArchives(archives)
    await chrome.storage.local.remove([OLD_KEY])
    console.log(`[TAA] Migrated v1 session (${old.events.length} events) → archive ${sid}`)
  } catch (err) {
    console.warn('[TAA] migrateV1 error:', err)
  }
}

// ── Init ──

migrateV1()
  .then(() => restoreSession())
  .then(() => {
    updateBadge()
    if (state === 'recording' || state === 'paused') {
      startKeepalive()
      injectIntoAllTabs()
      broadcastState()
    }
  })
  .catch(() => {
    updateBadge()
  })

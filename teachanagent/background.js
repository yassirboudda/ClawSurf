/* TeachAnAgent — Background Service Worker
 *
 * Manages recording state and aggregates events from content scripts.
 * State machine: idle → recording → (paused ↔ recording) → idle
 * Events are kept in memory and cleared on new recording session.
 */

let state = 'idle' // idle | recording | paused
let events = []
let sessionStartedAt = null

// ── State helpers ──

function getState() {
  return { state, eventCount: events.length, sessionStartedAt }
}

function startRecording() {
  // Clear previous session
  events = []
  sessionStartedAt = new Date().toISOString()
  state = 'recording'
  events.push({ ts: sessionStartedAt, type: 'session_start' })
  broadcastState()
}

function pauseRecording() {
  if (state !== 'recording') return
  state = 'paused'
  events.push({ ts: new Date().toISOString(), type: 'recording_paused' })
  broadcastState()
}

function resumeRecording() {
  if (state !== 'paused') return
  state = 'recording'
  events.push({ ts: new Date().toISOString(), type: 'recording_resumed' })
  broadcastState()
}

function stopRecording() {
  if (state === 'idle') return
  events.push({ ts: new Date().toISOString(), type: 'session_end' })
  state = 'idle'
  broadcastState()
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

  // To popup (if open)
  chrome.runtime.sendMessage(msg).catch(() => {})

  // To all content scripts
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {})
      }
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

// ── Message handler ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return

  switch (msg.type) {
    case 'teachanagent-get-state':
      sendResponse(getState())
      return

    case 'teachanagent-start':
      startRecording()
      // Inject content script into all existing tabs
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
            injectContentScript(tab.id)
          }
        }
      })
      sendResponse(getState())
      return

    case 'teachanagent-pause':
      pauseRecording()
      sendResponse(getState())
      return

    case 'teachanagent-resume':
      resumeRecording()
      sendResponse(getState())
      return

    case 'teachanagent-stop':
      stopRecording()
      sendResponse(getState())
      return

    case 'teachanagent-get-events':
      sendResponse({ events: getEvents() })
      return

    case 'teachanagent-event': {
      // Event from content script
      if (state !== 'recording') return
      const event = msg.event
      if (event) {
        event.ts = event.ts || new Date().toISOString()
        if (sender.tab) {
          event.tabId = sender.tab.id
          event.tabUrl = sender.tab.url || event.url
        }
        events.push(event)
        // Notify popup of new count
        chrome.runtime
          .sendMessage({
            type: 'teachanagent-event-count',
            eventCount: events.length,
          })
          .catch(() => {})
      }
      return
    }
  }
})

// ── Auto-inject on new tabs while recording ──

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (state === 'recording' && changeInfo.status === 'complete') {
    injectContentScript(tabId)
  }
})

chrome.tabs.onCreated.addListener((tab) => {
  if (state === 'recording' && tab.id) {
    // Small delay so the tab has a URL
    setTimeout(() => injectContentScript(tab.id), 300)
  }
})

// ── Init badge ──
updateBadge()

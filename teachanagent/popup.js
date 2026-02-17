/* TeachAnAgent — Popup Controller */

const btnRecord = document.getElementById('btnRecord')
const btnPause = document.getElementById('btnPause')
const btnStop = document.getElementById('btnStop')
const btnExport = document.getElementById('btnExport')
const statusDot = document.getElementById('statusDot')
const statusText = document.getElementById('statusText')
const eventCount = document.getElementById('eventCount')

function updateUI(st) {
  const s = st.state || 'idle'
  const count = st.eventCount || 0

  // Status dot
  statusDot.className = 'status-dot ' + s

  // Status text
  if (s === 'recording') statusText.textContent = 'Recording…'
  else if (s === 'paused') statusText.textContent = 'Paused'
  else statusText.textContent = 'Ready'

  // Event count
  eventCount.textContent = count + ' event' + (count !== 1 ? 's' : '')

  // Button states
  if (s === 'idle') {
    btnRecord.disabled = false
    btnRecord.innerHTML = '⏺ Record'
    btnPause.disabled = true
    btnStop.disabled = true
    btnExport.disabled = count === 0
  } else if (s === 'recording') {
    btnRecord.disabled = true
    btnPause.disabled = false
    btnStop.disabled = false
    btnExport.disabled = true // can't export while recording
  } else if (s === 'paused') {
    btnRecord.disabled = false
    btnRecord.innerHTML = '▶ Resume'
    btnPause.disabled = true
    btnStop.disabled = false
    btnExport.disabled = true
  }
}

// ── Button handlers ──

btnRecord.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'teachanagent-get-state' }, (res) => {
    if (res && res.state === 'paused') {
      chrome.runtime.sendMessage({ type: 'teachanagent-resume' }, updateUI)
    } else {
      chrome.runtime.sendMessage({ type: 'teachanagent-start' }, updateUI)
    }
  })
})

btnPause.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'teachanagent-pause' }, updateUI)
})

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'teachanagent-stop' }, updateUI)
})

btnExport.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'teachanagent-get-events' }, (res) => {
    if (!res || !res.events || res.events.length === 0) return

    const blob = new Blob([JSON.stringify(res.events, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')

    const now = new Date()
    const stamp =
      now.toISOString().split('T')[0] +
      '_' +
      now.toTimeString().split(' ')[0].replace(/:/g, '-')

    a.href = url
    a.download = 'teachanagent-' + stamp + '.json'
    a.click()
    URL.revokeObjectURL(url)
  })
})

// ── Listen for live updates ──

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'teachanagent-state') {
    updateUI(msg)
  }
  if (msg && msg.type === 'teachanagent-event-count') {
    eventCount.textContent =
      msg.eventCount + ' event' + (msg.eventCount !== 1 ? 's' : '')
  }
})

// ── Init ──

chrome.runtime.sendMessage({ type: 'teachanagent-get-state' }, (res) => {
  if (res) updateUI(res)
})

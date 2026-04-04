/* TeachAnAgent — Popup Controller v2.0 */

const btnRecord = document.getElementById('btnRecord')
const btnPause = document.getElementById('btnPause')
const btnStop = document.getElementById('btnStop')
const btnExport = document.getElementById('btnExport')
const statusDot = document.getElementById('statusDot')
const statusText = document.getElementById('statusText')
const eventCount = document.getElementById('eventCount')
const archiveSection = document.getElementById('archiveSection')
const archiveList = document.getElementById('archiveList')

function updateUI(st) {
  const s = st.state || 'idle'
  const count = st.eventCount || 0

  statusDot.className = 'status-dot ' + s

  if (s === 'recording') statusText.textContent = 'Recording…'
  else if (s === 'paused') statusText.textContent = 'Paused'
  else statusText.textContent = 'Ready'

  eventCount.textContent = count + ' event' + (count !== 1 ? 's' : '')

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
    btnExport.disabled = true
  } else if (s === 'paused') {
    btnRecord.disabled = false
    btnRecord.innerHTML = '▶ Resume'
    btnPause.disabled = true
    btnStop.disabled = false
    btnExport.disabled = true
  }
}

// ── Download helper ──

function downloadJSON(data, prefix) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const now = new Date()
  const stamp =
    now.toISOString().split('T')[0] +
    '_' +
    now.toTimeString().split(' ')[0].replace(/:/g, '-')
  a.href = url
  a.download = (prefix || 'teachanagent') + '-' + stamp + '.json'
  a.click()
  URL.revokeObjectURL(url)
}

// ── Button handlers ──

btnRecord.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'teachanagent-get-state' }, (res) => {
    if (res && res.state === 'paused') {
      chrome.runtime.sendMessage({ type: 'teachanagent-resume' }, (r) => {
        if (r) updateUI(r)
      })
    } else {
      chrome.runtime.sendMessage({ type: 'teachanagent-start' }, (r) => {
        if (r) updateUI(r)
        // Refresh archives after start (old session archived)
        setTimeout(loadArchives, 300)
      })
    }
  })
})

btnPause.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'teachanagent-pause' }, (r) => { if (r) updateUI(r) })
})

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'teachanagent-stop' }, (r) => {
    if (r) updateUI(r)
    // Refresh archives after stop
    setTimeout(loadArchives, 300)
  })
})

btnExport.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'teachanagent-get-events' }, (res) => {
    if (!res || !res.events || res.events.length === 0) return
    downloadJSON(res.events, 'teachanagent')
  })
})

// ── Archives ──

function formatDate(iso) {
  if (!iso) return '?'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function loadArchives() {
  chrome.runtime.sendMessage({ type: 'teachanagent-get-archives' }, (res) => {
    if (chrome.runtime.lastError) return
    const archives = (res && res.archives) || []
    if (archives.length === 0) {
      archiveSection.style.display = 'none'
      return
    }

    archiveSection.style.display = 'block'
    archiveList.innerHTML = ''

    // Show newest first
    for (let i = archives.length - 1; i >= 0; i--) {
      const a = archives[i]
      const item = document.createElement('div')
      item.className = 'archive-item'

      const info = document.createElement('div')
      info.className = 'archive-info'
      info.innerHTML = `<strong>${a.eventCount} events</strong><br/>${formatDate(a.startedAt)}`

      const btn = document.createElement('button')
      btn.className = 'archive-export'
      btn.textContent = '📥 Export'
      btn.addEventListener('click', () => exportArchive(a.sessionId))

      item.appendChild(info)
      item.appendChild(btn)
      archiveList.appendChild(item)
    }
  })
}

function exportArchive(sessionId) {
  chrome.runtime.sendMessage(
    { type: 'teachanagent-get-archived-events', sessionId },
    (res) => {
      if (!res || !res.events || res.events.length === 0) {
        console.warn('No events for archived session', sessionId)
        return
      }
      downloadJSON(res.events, 'teachanagent-archive')
    }
  )
}

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
loadArchives()

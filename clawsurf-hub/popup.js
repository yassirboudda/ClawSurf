/* AMI Browser – Popup logic */
'use strict';

const GW = 'http://127.0.0.1:18789';
const MCP = 'http://127.0.0.1:9223';
const STORE = {
  stats: 'ami_browser_stats',
  automations: 'ami_browser_automations',
};

document.addEventListener('DOMContentLoaded', async () => {
  // Status checks
  check(GW + '/health', 'dot-gw');
  check(MCP + '/health', 'dot-mcp');

  // Stats
  chrome.storage.local.get([STORE.stats, STORE.automations], d => {
    const s = d[STORE.stats] || {};
    const c = d[STORE.automations] || [];
    document.getElementById('p-tasks').textContent = s.tasks || 0;
    document.getElementById('p-pages').textContent = s.pages || 0;
    document.getElementById('p-crons').textContent = c.length;
  });

  // Quick command
  const input = document.getElementById('quick-cmd');
  const btn = document.getElementById('quick-send');
  btn.addEventListener('click', () => sendQuick(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') sendQuick(input.value); });

  // Links
  document.getElementById('link-newtab').addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://newtab' });
    window.close();
  });
  document.getElementById('link-sidepanel').addEventListener('click', e => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'open-sidepanel' });
    window.close();
  });
});

async function check(url, dotId) {
  const dot = document.getElementById(dotId);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    dot.classList.toggle('on', r.ok);
    dot.classList.toggle('off', !r.ok);
  } catch {
    dot.classList.add('off');
  }
}

async function sendQuick(text) {
  if (!text.trim()) return;
  try {
    await fetch(`${GW}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text.trim(), source: 'popup' }),
    });
  } catch { /* gateway offline */ }
  window.close();
}

/* AMI Browser – Side Panel chat */
'use strict';

const GW = 'http://127.0.0.1:18789';
const msgs = document.getElementById('sp-messages');
const input = document.getElementById('sp-input');
const btn = document.getElementById('sp-send');

function addMsg(role, text) {
  const d = document.createElement('div');
  d.className = `sp-msg sp-msg-${role}`;
  const b = document.createElement('div');
  b.className = 'sp-bubble';
  b.textContent = text;
  d.appendChild(b);
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
}

async function send() {
  const text = input.value.trim();
  if (!text) return;
  addMsg('user', text);
  input.value = '';

  document.getElementById('sp-status').textContent = 'Thinking…';
  try {
    const r = await fetch(`${GW}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, source: 'sidepanel' }),
    });
    if (r.ok) {
      const data = await r.json();
      addMsg('agent', data.reply || data.message || JSON.stringify(data));
    } else {
      addMsg('agent', `Gateway error (${r.status})`);
    }
  } catch {
    addMsg('agent', 'Gateway unreachable. Start it with: node gateway.js');
  }
  document.getElementById('sp-status').textContent = 'Ready';
}

btn.addEventListener('click', send);
input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

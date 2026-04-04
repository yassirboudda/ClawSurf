/* ═══════════════════════════════════════════════════════════════
   AMI Browser – New Tab logic
   Chat, scheduled automation, gateway/MCP comms, agent config
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ── Constants ── */
const GW_HTTP  = 'http://127.0.0.1:18789';
const GW_WS    = 'ws://127.0.0.1:18792';
const MCP_HTTP = 'http://127.0.0.1:9223';

const STORE_KEYS = {
  config:    'ami_config',
  crons:     'ami_automations',
  shortcuts: 'ami_shortcuts',
  stats:     'ami_stats',
  chatHist:  'ami_chat_history',
};

const BUILTIN_EXT_NAMES = {
  shield: 'AMI Shield',
  recorder: 'TeachAnAgent',
  rewards: 'AMI Rewards',
};

/* ── Default shortcuts ── */
const DEFAULT_SHORTCUTS = [
  { label: 'Google',         url: 'https://google.com',          icon: 'https://cdn.simpleicons.org/google',              bg: '#fde68a' },
  { label: 'GitHub',         url: 'https://github.com',          icon: 'https://cdn.simpleicons.org/github',              bg: '#d8b4fe' },
  { label: 'YouTube',        url: 'https://youtube.com',         icon: 'https://cdn.simpleicons.org/youtube/FF0000',      bg: '#fca5a5' },
  { label: 'ChatGPT',        url: 'https://chat.openai.com',     icon: 'https://cdn.simpleicons.org/openai',              bg: '#bbf7d0' },
  { label: 'AMI Finance',    url: 'https://app.ami.finance',     icon: 'icons/icon48.png',                                bg: '#a78bfa' },
  { label: 'Claude',         url: 'https://claude.ai',           icon: 'https://cdn.simpleicons.org/anthropic',           bg: '#fdba74' },
  { label: 'Reddit',         url: 'https://reddit.com',          icon: 'https://cdn.simpleicons.org/reddit/FF4500',       bg: '#fdba74' },
  { label: 'X / Twitter',    url: 'https://x.com',               icon: 'https://cdn.simpleicons.org/x',                   bg: '#e2e8f0' },
  { label: 'Spotify',        url: 'https://open.spotify.com',    icon: 'https://cdn.simpleicons.org/spotify/1DB954',      bg: '#86efac' },
  { label: 'LinkedIn',       url: 'https://linkedin.com',        icon: 'https://cdn.simpleicons.org/linkedin/0A66C2',     bg: '#93c5fd' },
  { label: 'Wikipedia',      url: 'https://wikipedia.org',       icon: 'https://cdn.simpleicons.org/wikipedia',           bg: '#a5f3fc' },
  { label: 'Amazon',         url: 'https://amazon.com',          icon: 'https://cdn.simpleicons.org/amazon/FF9900',       bg: '#fcd34d' },
];

/* ══════════════════════════════════════
   Storage helpers (chrome.storage.local)
   ══════════════════════════════════════ */
function storeGet(key, fallback) {
  return new Promise(r => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(key, d => r(d[key] ?? fallback));
    } else {
      try { r(JSON.parse(localStorage.getItem(key)) ?? fallback); }
      catch { r(fallback); }
    }
  });
}

function storeSet(key, val) {
  return new Promise(r => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ [key]: val }, r);
    } else {
      localStorage.setItem(key, JSON.stringify(val));
      r();
    }
  });
}

/* ══════════════════════════════════════
   DOM refs
   ══════════════════════════════════════ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const dom = {
  searchInput:   $('#search-input'),
  pillGw:        $('#pill-gateway'),
  pillMcp:       $('#pill-mcp'),
  quickLinksGrid:$('#quick-links-grid'),
  statTasks:     $('#stat-tasks'),
  statPages:     $('#stat-pages'),
  statCrons:     $('#stat-crons'),
  statAdsBlocked:$('#stat-ads-blocked'),
  statRecorderState: $('#stat-recorder-state'),
  statRecorderEvents: $('#stat-recorder-events'),
  statRewardsState: $('#stat-rewards-state'),
  chatMessages:  $('#chat-messages'),
  chatInput:     $('#chat-input'),
  btnSend:       $('#btn-send'),
  btnClearChat:  $('#btn-clear-chat'),
  btnAttach:     $('#btn-attach'),
  btnScreenshot: $('#btn-screenshot'),
  btnCron:       $('#btn-cron'),
  agentStatus:   $('#agent-status'),
  cronList:      $('#cron-list'),
  btnNewCron:    $('#btn-new-cron'),
  btnSettings:   $('#btn-settings'),
  modalOverlay:  $('#modal-overlay'),
  modalCron:     $('#modal-cron'),
  modalSettings: $('#modal-settings'),
  llmProvider:   $('#llm-provider'),
  llmApiKey:     $('#llm-api-key'),
  llmUrl:        $('#llm-url'),
  llmModel:      $('#llm-model'),
  systemPrompt:  $('#system-prompt'),
  cfgAutoexec:   $('#cfg-autoexec'),
  cfgThinking:   $('#cfg-thinking'),
  btnSaveConfig: $('#btn-save-config'),
  cronFreq:      $('#cron-freq'),
  cronCustom:    $('#cron-custom'),
  cronName:      $('#cron-name'),
  cronTask:      $('#cron-task'),
  cronNotify:    $('#cron-notify'),
  btnCreateCron: $('#btn-create-cron'),
  btnAddShortcut:$('#btn-add-shortcut'),
  btnMic:        $('#btn-mic'),
  btnTts:        $('#btn-tts'),
};

/* ══════════════════════════════════════
   State
   ══════════════════════════════════════ */
let wsRelay = null;
let config = {};
let crons = [];
let stats = { tasks: 0, pages: 0, crons: 0 };
let chatHistory = [];
let agentBusy = false;
let extIdCache = {};

/* ══════════════════════════════════════
   Integration slider (auto-scroll + drag)
   ══════════════════════════════════════ */
const SLIDER_INTEGRATIONS = [
  { label: 'OpenAI',        logo: 'https://cdn.simpleicons.org/openai' },
  { label: 'Anthropic',     logo: 'https://cdn.simpleicons.org/anthropic' },
  { label: 'Google Gemini',  logo: 'https://cdn.simpleicons.org/googlegemini/4285F4' },
  { label: 'Mistral AI',    logo: 'https://cdn.simpleicons.org/mistralai' },
  { label: 'Meta',          logo: 'https://cdn.simpleicons.org/meta/0082FB' },
  { label: 'HuggingFace',   logo: 'https://cdn.simpleicons.org/huggingface' },
  { label: 'Groq',          logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23f55036'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='42' fill='white'%3EG%3C/text%3E%3C/svg%3E" },
  { label: 'Perplexity',    logo: 'https://cdn.simpleicons.org/perplexity' },
  { label: 'Telegram',      logo: 'https://cdn.simpleicons.org/telegram/26A5E4' },
  { label: 'Discord',       logo: 'https://cdn.simpleicons.org/discord/5865F2' },
  { label: 'WhatsApp',      logo: 'https://cdn.simpleicons.org/whatsapp/25D366' },
  { label: 'Slack',         logo: 'https://cdn.simpleicons.org/slack' },
  { label: 'Signal',        logo: 'https://cdn.simpleicons.org/signal/3A76F0' },
  { label: 'Microsoft Teams', logo: 'https://cdn.simpleicons.org/microsoftteams/6264A7' },
  { label: 'Stripe',        logo: 'https://cdn.simpleicons.org/stripe/635BFF' },
  { label: 'PayPal',        logo: 'https://cdn.simpleicons.org/paypal/003087' },
  { label: 'GitHub',        logo: 'https://cdn.simpleicons.org/github' },
  { label: 'GitLab',        logo: 'https://cdn.simpleicons.org/gitlab/FC6D26' },
  { label: 'Vercel',        logo: 'https://cdn.simpleicons.org/vercel' },
  { label: 'Cloudflare',    logo: 'https://cdn.simpleicons.org/cloudflare/F38020' },
  { label: 'AWS',           logo: 'https://cdn.simpleicons.org/amazonaws/FF9900' },
  { label: 'Docker',        logo: 'https://cdn.simpleicons.org/docker/2496ED' },
  { label: 'Salesforce',    logo: 'https://cdn.simpleicons.org/salesforce/00A1E0' },
  { label: 'HubSpot',       logo: 'https://cdn.simpleicons.org/hubspot/FF7A59' },
  { label: 'Jira',          logo: 'https://cdn.simpleicons.org/jira/0052CC' },
  { label: 'Notion',        logo: 'https://cdn.simpleicons.org/notion' },
  { label: 'Linear',        logo: 'https://cdn.simpleicons.org/linear/5E6AD2' },
  { label: 'MongoDB',       logo: 'https://cdn.simpleicons.org/mongodb/47A248' },
  { label: 'Supabase',      logo: 'https://cdn.simpleicons.org/supabase/3FCF8E' },
  { label: 'Firebase',      logo: 'https://cdn.simpleicons.org/firebase/FFCA28' },
  { label: 'CoinGecko',     logo: 'https://cdn.simpleicons.org/coingecko/8BC53F' },
  { label: 'Ethereum',      logo: 'https://cdn.simpleicons.org/ethereum/3C3C3D' },
  { label: 'Twilio',        logo: 'https://cdn.simpleicons.org/twilio/F22F46' },
  { label: 'Sentry',        logo: 'https://cdn.simpleicons.org/sentry/362D59' },
  { label: 'Datadog',       logo: 'https://cdn.simpleicons.org/datadog/632CA6' },
  { label: 'Grafana',       logo: 'https://cdn.simpleicons.org/grafana/F46800' },
  { label: 'ElevenLabs',    logo: 'https://cdn.simpleicons.org/elevenlabs' },
  { label: 'Pinecone',      logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23000'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3EP%3C/text%3E%3C/svg%3E" },
  { label: 'LangChain',     logo: 'https://cdn.simpleicons.org/langchain/1C3C3C' },
  { label: 'Stability AI',  logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%237c3aed'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3ESA%3C/text%3E%3C/svg%3E" },
  { label: 'Plaid',         logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23111'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3EPL%3C/text%3E%3C/svg%3E" },
  { label: 'Shopify',       logo: 'https://cdn.simpleicons.org/shopify/7AB55C' },
  { label: 'Zapier',        logo: 'https://cdn.simpleicons.org/zapier/FF4A00' },
];

function initIntegrationSlider() {
  const slider = document.getElementById('integration-slider');
  const track  = document.getElementById('integration-track');
  if (!slider || !track) return;

  const fallbackIcon = (label) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%239333ea'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='40' fill='white'%3E${encodeURIComponent(label.charAt(0))}%3C/text%3E%3C/svg%3E`;

  const pillHTML = SLIDER_INTEGRATIONS.map(i =>
    `<span class="integration-pill"><img src="${i.logo}" alt="" width="16" height="16" loading="lazy" onerror="this.onerror=null;this.src='${fallbackIcon(i.label)}'">${i.label}</span>`
  ).join('');
  track.innerHTML = pillHTML + pillHTML;          // duplicate for seamless loop

  let speed = 0.5;
  let isDragging = false;
  let startX = 0, startScroll = 0;

  function animate() {
    if (!isDragging) {
      slider.scrollLeft += speed;
      if (slider.scrollLeft >= track.scrollWidth / 2) {
        slider.scrollLeft -= track.scrollWidth / 2;
      }
    }
    requestAnimationFrame(animate);
  }

  slider.addEventListener('mousedown', e => {
    isDragging = true;
    startX = e.pageX;
    startScroll = slider.scrollLeft;
  });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    slider.scrollLeft = startScroll - (e.pageX - startX);
  });
  window.addEventListener('mouseup', () => { isDragging = false; });

  slider.addEventListener('touchstart', e => {
    isDragging = true;
    startX = e.touches[0].pageX;
    startScroll = slider.scrollLeft;
  }, { passive: true });
  slider.addEventListener('touchmove', e => {
    if (!isDragging) return;
    slider.scrollLeft = startScroll - (e.touches[0].pageX - startX);
  }, { passive: true });
  slider.addEventListener('touchend', () => { isDragging = false; });

  slider.addEventListener('mouseenter', () => { speed = 0.2; });
  slider.addEventListener('mouseleave', () => { speed = 0.5; });

  requestAnimationFrame(animate);
}

/* ══════════════════════════════════════
   Init
   ══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  config      = await storeGet(STORE_KEYS.config, {});
  crons       = await storeGet(STORE_KEYS.crons, []);
  stats       = await storeGet(STORE_KEYS.stats, { tasks: 0, pages: 0, crons: 0 });
  chatHistory = await storeGet(STORE_KEYS.chatHist, []);
  const shortcuts = await storeGet(STORE_KEYS.shortcuts, DEFAULT_SHORTCUTS);

  renderShortcuts(shortcuts);
  renderStats();
  renderCrons();
  loadConfig();
  restoreChat();
  checkServices();
  bindEvents();
  connectRelay();
  loadSkillsLibrary();
  loadPersona();
  loadMemoryViewer();
  refreshBuiltinsStatus();
  initIntegrationSlider();
  setInterval(refreshBuiltinsStatus, 12000);

  // AMI Tools quick access links
  const toolAgent = document.getElementById('tool-link-agent');
  if (toolAgent) toolAgent.addEventListener('click', e => { e.preventDefault(); document.getElementById('chat-input')?.focus(); document.getElementById('col-chat')?.scrollIntoView({ behavior: 'smooth' }); });
  const toolConnections = document.getElementById('tool-link-connections');
  if (toolConnections) toolConnections.addEventListener('click', e => { e.preventDefault(); document.getElementById('btn-open-connections')?.click(); });
  const toolMemory = document.getElementById('tool-link-memory');
  if (toolMemory) toolMemory.addEventListener('click', e => { e.preventDefault(); document.querySelector('.card-memory')?.scrollIntoView({ behavior: 'smooth' }); });
  const toolSkills = document.getElementById('tool-link-skills');
  if (toolSkills) toolSkills.addEventListener('click', e => { e.preventDefault(); document.querySelector('.card-skills')?.scrollIntoView({ behavior: 'smooth' }); });
  const toolSettings = document.getElementById('tool-link-settings');
  if (toolSettings) toolSettings.addEventListener('click', e => { e.preventDefault(); document.getElementById('btn-settings')?.click(); });

  // Scroll chat column into view (don't steal focus — keeps omnibox prompt)
  requestAnimationFrame(() => {
    document.getElementById('col-chat')?.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'start' });
  });
});

/* ══════════════════════════════════════
   Search bar – navigate or Google search
   ══════════════════════════════════════ */
function handleSearch(val) {
  const q = val.trim();
  if (!q) return;
  if (/^https?:\/\//i.test(q) || /^[\w-]+(\.[\w-]+)+/.test(q)) {
    const url = q.startsWith('http') ? q : `https://${q}`;
    window.location.href = url;
  } else {
    window.location.href = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  }
}

/* ══════════════════════════════════════
   Quick links
   ══════════════════════════════════════ */
function renderShortcuts(shortcuts) {
  dom.quickLinksGrid.innerHTML = '';
  shortcuts.forEach(s => {
    const a = document.createElement('a');
    a.className = 'shortcut-tile';
    a.href = s.url;
    const isUrl = s.icon && (s.icon.startsWith('http') || s.icon.startsWith('icons/'));
    const iconContent = isUrl
      ? `<img src="${s.icon}" alt="${s.label}" width="20" height="20">`
      : s.icon;
    a.innerHTML = `
      <div class="shortcut-icon" style="background:${s.bg}">${iconContent}</div>
      <span class="shortcut-label">${s.label}</span>
    `;
    dom.quickLinksGrid.appendChild(a);
  });
}

/* ══════════════════════════════════════
   Stats
   ══════════════════════════════════════ */
function renderStats() {
  dom.statTasks.textContent = stats.tasks;
  dom.statPages.textContent = stats.pages;
  dom.statCrons.textContent = crons.length;
}

async function getExtensionIdByName(name) {
  if (extIdCache[name]) return extIdCache[name];
  if (typeof chrome === 'undefined' || !chrome.management) return null;

  try {
    const all = await chrome.management.getAll();
    const found = all.find((e) => e.enabled && e.name === name);
    const id = found ? found.id : null;
    if (id) extIdCache[name] = id;
    return id;
  } catch {
    return null;
  }
}

function sendToExtension(extId, message) {
  return new Promise((resolve) => {
    if (!extId || typeof chrome === 'undefined' || !chrome.runtime) {
      resolve(null);
      return;
    }
    chrome.runtime.sendMessage(extId, message, (res) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(res || null);
    });
  });
}

async function refreshBuiltinsStatus() {
  // AMI Shield
  const shieldId = await getExtensionIdByName(BUILTIN_EXT_NAMES.shield);
  const shieldStats = await sendToExtension(shieldId, { type: 'GET_STATS', tabId: -1 });
  dom.statAdsBlocked.textContent = String(shieldStats?.totalBlocked ?? 0);

  // TeachAnAgent
  const recorderId = await getExtensionIdByName(BUILTIN_EXT_NAMES.recorder);
  const recorderState = await sendToExtension(recorderId, { type: 'teachanagent-get-state' });
  const stateRaw = recorderState?.state || 'idle';
  const stateMap = {
    recording: 'Recording',
    paused: 'Paused',
    idle: 'Idle',
  };
  dom.statRecorderState.textContent = stateMap[stateRaw] || 'Idle';
  dom.statRecorderEvents.textContent = String(recorderState?.eventCount ?? 0);

  // AMI Rewards
  const rewardsId = await getExtensionIdByName(BUILTIN_EXT_NAMES.rewards);
  const rewardsState = await sendToExtension(rewardsId, { type: 'GET_REWARDS_STATUS' });
  if (!rewardsState) {
    dom.statRewardsState.textContent = 'SOON';
  } else if (rewardsState.status === 'coming_soon') {
    dom.statRewardsState.textContent = 'SOON';
  } else if (rewardsState.enrolled) {
    dom.statRewardsState.textContent = `Active (${rewardsState.balance || 0})`;
  } else {
    dom.statRewardsState.textContent = 'Available';
  }
}

/* ══════════════════════════════════════
   Cron jobs
   ══════════════════════════════════════ */
function renderCrons() {
  if (crons.length === 0) {
    dom.cronList.innerHTML = '<div class="empty-state">No scheduled jobs yet. Use the chat or click ⏰ to create one.</div>';
    return;
  }
  dom.cronList.innerHTML = '';
  crons.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'cron-item';
    el.innerHTML = `
      <div class="cron-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
      <div class="cron-info">
        <div class="cron-name">${escHtml(c.name)}</div>
        <div class="cron-schedule">${escHtml(c.freq)}</div>
      </div>
      <label class="cron-toggle">
        <input type="checkbox" ${c.enabled ? 'checked' : ''} data-idx="${i}">
        <span class="slider"></span>
      </label>
    `;
    const toggle = el.querySelector('input');
    toggle.addEventListener('change', () => toggleCron(i, toggle.checked));
    dom.cronList.appendChild(el);
  });
}

function toggleCron(idx, on) {
  crons[idx].enabled = on;
  saveCrons();
  // Notify background to update alarm
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({ type: 'cron-toggle', idx, enabled: on });
  }
}

function createCron() {
  const name = dom.cronName.value.trim();
  const task = dom.cronTask.value.trim();
  if (!name || !task) return;

  const freq = dom.cronFreq.value === 'custom' ? dom.cronCustom.value.trim() : dom.cronFreq.value;
  const notify = dom.cronNotify.checked;

  const job = { id: Date.now(), name, task, freq, notify, enabled: true };
  crons.push(job);
  saveCrons();
  renderCrons();
  renderStats();
  closeModals();

  // Tell background to set alarm
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({ type: 'cron-create', job });
  }

  // Reset form
  dom.cronName.value = '';
  dom.cronTask.value = '';
  dom.cronFreq.value = '1h';
}

async function saveCrons() {
  await storeSet(STORE_KEYS.crons, crons);
}

/* ══════════════════════════════════════
   Chat
   ══════════════════════════════════════ */
function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = formatMessage(text);
  div.appendChild(bubble);

  // User messages get an edit button (like GitHub Copilot)
  if (role === 'user') {
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-edit-btn';
    editBtn.title = 'Edit & resend';
    editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    editBtn.addEventListener('click', () => {
      // Load text into input for editing
      dom.chatInput.value = text;
      dom.chatInput.focus();
      autoResizeInput();
      // Remove this message and all subsequent messages from DOM and history
      const allMsgs = [...dom.chatMessages.querySelectorAll('.msg')];
      const idx = allMsgs.indexOf(div);
      if (idx >= 0) {
        for (let i = allMsgs.length - 1; i >= idx; i--) {
          allMsgs[i].remove();
        }
        // Trim chat history to match
        const histIdx = chatHistory.length - (allMsgs.length - idx);
        if (histIdx >= 0) chatHistory.splice(histIdx);
        storeSet(STORE_KEYS.chatHist, chatHistory.slice(-100));
      }
    });
    div.appendChild(editBtn);
  }

  dom.chatMessages.appendChild(div);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  chatHistory.push({ role, text, ts: Date.now() });
  storeSet(STORE_KEYS.chatHist, chatHistory.slice(-100));
}

function showThinking() {
  const div = document.createElement('div');
  div.className = 'msg msg-agent';
  div.id = 'msg-thinking';
  div.innerHTML = `<div class="msg-thinking"><div class="dot-pulse"><span></span><span></span><span></span></div></div>`;
  dom.chatMessages.appendChild(div);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function hideThinking() {
  const t = $('#msg-thinking');
  if (t) t.remove();
}

function formatMessage(text) {
  // Simple code-block parser
  return escHtml(text)
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function restoreChat() {
  chatHistory.forEach(m => {
    const div = document.createElement('div');
    div.className = `msg msg-${m.role}`;
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = formatMessage(m.text);
    div.appendChild(bubble);
    dom.chatMessages.appendChild(div);
  });
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

/* ── Auto-memory: save chat exchanges automatically ── */
function autoRemember(userMsg, agentReply) {
  // Skip trivial messages (greetings, very short)
  const trivial = /^(hi|hello|hey|thanks|ok|yes|no|bye|sure|got it)\b/i;
  if (trivial.test(userMsg.trim()) && agentReply.length < 120) return;
  // Skip error/status messages
  if (/^Gateway returned|^⚠|^Error/i.test(agentReply)) return;

  const summary = `Q: ${userMsg.slice(0, 200)}${userMsg.length > 200 ? '…' : ''}\nA: ${agentReply.slice(0, 300)}${agentReply.length > 300 ? '…' : ''}`;
  storeGet('ami_memory', []).then(mem => {
    // Deduplicate: skip if last memory has the same question
    if (mem.length && mem[mem.length - 1].text && mem[mem.length - 1].text.startsWith(`Q: ${userMsg.slice(0, 50)}`)) return;
    mem.push({ text: summary, ts: Date.now(), source: 'auto-chat' });
    // Keep last 500 entries max
    if (mem.length > 500) mem = mem.slice(-500);
    storeSet('ami_memory', mem);
    refreshMemoryViewer();
  });
}

function refreshMemoryViewer() {
  const memList = document.querySelector('.memory-list');
  if (!memList) return;
  storeGet('ami_memory', []).then(mem => {
    if (typeof renderMemoryList === 'function') renderMemoryList(mem);
  });
}

async function sendChat() {
  const text = dom.chatInput.value.trim();
  if (!text || agentBusy) return;

  addMessage('user', text);
  dom.chatInput.value = '';
  autoResizeInput();
  agentBusy = true;
  dom.agentStatus.textContent = 'Thinking…';
  showThinking();

  // Check for built-in commands
  const handled = handleBuiltinCommand(text);
  if (handled) return;

  // Try gateway
  try {
    const resp = await fetch(`${GW_HTTP}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        config,
        history: chatHistory.slice(-20).map(m => ({ role: m.role, content: m.text })),
      })
    });
    hideThinking();
    if (resp.ok) {
      const data = await resp.json();
      const reply = data.reply || data.message || JSON.stringify(data);
      addMessage('agent', reply);
      if (data.actions) executeActions(data.actions);
      // Auto-memory: save significant exchanges
      autoRemember(text, reply);
    } else {
      addMessage('agent', `Gateway returned ${resp.status}. Make sure the gateway is running.`);
    }
  } catch (err) {
    hideThinking();
    // Fallback: interpret simple commands locally
    const local = localCommandFallback(text);
    addMessage('agent', local);
  }

  agentBusy = false;
  dom.agentStatus.textContent = 'Ready';
}

/* ── Built-in commands ── */
function handleBuiltinCommand(text) {
  const lower = text.toLowerCase().trim();

  // Navigate command — skip compound intents ("go to youtube and play X") so they reach the gateway
  const compoundCheck = /^(?:go to|open|navigate to?|visit)\s+\S+\s+(?:and|then)\s+/i.test(lower);
  if (!compoundCheck) {
    const navMatch = lower.match(/^(?:go to|open|navigate to|visit)\s+(.+)/);
    if (navMatch) {
      const url = navMatch[1].trim();
      hideThinking();
      addMessage('agent', `Opening ${url}…`);
      agentBusy = false;
      dom.agentStatus.textContent = 'Ready';
      setTimeout(() => handleSearch(url), 300);
      return true;
    }
  }

  // Screenshot command
  if (/^screenshot|^capture|^snap/.test(lower)) {
    hideThinking();
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'screenshot' }, resp => {
        if (resp && resp.dataUrl) {
          addMessage('agent', `Screenshot captured!`);
        } else {
          addMessage('agent', 'Could not capture screenshot.');
        }
      });
    } else {
      addMessage('agent', 'Screenshot requires the browser extension context.');
    }
    agentBusy = false;
    dom.agentStatus.textContent = 'Ready';
    return true;
  }

  // Schedule command
  const schedMatch = lower.match(/^(?:schedule|cron|every)\s+(.+)/);
  if (schedMatch) {
    hideThinking();
    dom.cronTask.value = schedMatch[1];
    openModal('cron');
    agentBusy = false;
    dom.agentStatus.textContent = 'Ready';
    return true;
  }

  // Quick local commands
  if (lower === 'clear chat' || lower === 'clear') {
    hideThinking();
    dom.chatMessages.innerHTML = '';
    chatHistory = [];
    storeSet(STORE_KEYS.chatHist, []);
    addMessage('system', 'Chat cleared.');
    agentBusy = false;
    dom.agentStatus.textContent = 'Ready';
    return true;
  }

  if (lower === 'settings') {
    hideThinking();
    openModal('settings');
    agentBusy = false;
    dom.agentStatus.textContent = 'Ready';
    return true;
  }

  if (lower === 'connections') {
    hideThinking();
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: chrome.runtime.getURL('connections.html') });
    }
    addMessage('system', 'Opening connections page…');
    agentBusy = false;
    dom.agentStatus.textContent = 'Ready';
    return true;
  }

  if (lower === 'status') {
    hideThinking();
    addMessage('agent', `Gateway ${dom.pillGw.classList.contains('offline') ? '❌ offline' : '✅ online'} | MCP ${dom.pillMcp.classList.contains('offline') ? '❌ offline' : '✅ online'} | Skills: ${allSkills.length} | Automations: ${crons.length}`);
    agentBusy = false;
    dom.agentStatus.textContent = 'Ready';
    return true;
  }

  if (lower === 'skills' || lower === 'list skills') {
    hideThinking();
    addMessage('agent', `🛠️ ${allSkills.length} skills loaded. Browse them in the Skills Library panel on the left, or ask me about a category like "finance skills" or "extraction skills".`);
    agentBusy = false;
    dom.agentStatus.textContent = 'Ready';
    return true;
  }

  if (lower === 'export chat') {
    hideThinking();
    const blob = new Blob([chatHistory.map(m => `[${m.role}] ${m.text}`).join('\n\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ami-chat-${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    addMessage('agent', '💾 Chat exported as text file.');
    agentBusy = false;
    dom.agentStatus.textContent = 'Ready';
    return true;
  }

  if (lower === 'version' || lower === 'about') {
    hideThinking();
    addMessage('agent', `AMI Browser v2.0\n${allSkills.length} skills | AI-powered automation workspace\nGateway: ${GW_HTTP} | WS: ${GW_WS} | MCP: ${MCP_HTTP}`);
    agentBusy = false;
    dom.agentStatus.textContent = 'Ready';
    return true;
  }

  // Remember/recall local
  const rememberMatch = lower.match(/^remember\s+(.+)/);
  if (rememberMatch) {
    hideThinking();
    storeGet('ami_memory', []).then(mem => {
      mem.push({ text: rememberMatch[1], ts: Date.now() });
      storeSet('ami_memory', mem);
      addMessage('agent', `🧠 Remembered: "${rememberMatch[1]}"`);
    });
    agentBusy = false;
    dom.agentStatus.textContent = 'Ready';
    return true;
  }

  const recallMatch = lower.match(/^(?:recall|what did i|memories)/);
  if (recallMatch) {
    hideThinking();
    storeGet('ami_memory', []).then(mem => {
      if (!mem.length) { addMessage('agent', '🧠 No memories stored yet. Say "remember <something>" to save.'); return; }
      addMessage('agent', `🧠 Memories (${mem.length}):\n${mem.slice(-20).map(m => `• ${m.text}`).join('\n')}`);
    });
    agentBusy = false;
    dom.agentStatus.textContent = 'Ready';
    return true;
  }

  return false;
}

/* ── Local fallback when gateway is unreachable ── */
function localCommandFallback(text) {
  return `I couldn't reach the gateway at ${GW_HTTP}. Make sure the AMI Browser gateway is running.\n\nTo start it, run:\n\`\`\`\nnode ~/workspace/ClawSurf/clawsurf-hub/gateway.js\n\`\`\`\n\nLocal commands always work:\n• \`go to <url>\` — Navigate\n• \`screenshot\` — Capture tab\n• \`schedule <task>\` — Create automation\n• \`remember <text>\` / \`recall\` — Memory\n• \`skills\` — Browse ${allSkills.length || '130+'} skills\n• \`settings\` / \`connections\` / \`status\`\n• \`clear chat\` / \`export chat\`\n• Use **Ctrl+Shift+A** on any page for quick chat`;
}

/* ── Dev logging ── */
function devLog(...args) {
  console.log(`%c[AMI-hub]`, 'color:#c084fc;font-weight:bold', ...args);
}

/* ── Execute agent actions ── */
function executeActions(actions) {
  if (!Array.isArray(actions)) return;
  devLog('executeActions received:', JSON.stringify(actions).slice(0, 500));
  actions.forEach(action => {
    // Route api-call actions through the gateway proxy (auto-injects credentials)
    if (action.type === 'api-call') {
      executeApiCallAction(action);
      return;
    }
    // Route cookie-grab actions through the background service worker
    if (action.type === 'cookie-grab') {
      executeCookieGrabAction(action);
      return;
    }

    // Handle navigation actions directly in the hub
    switch (action.type) {
      case 'navigate':
        if (action.url) {
          addMessage('system', `🌐 Navigating to ${action.url}`);
          // Store follow-up actions for the content script on the new page
          if (action.followUp && action.followUp.length > 0) {
            devLog('Storing followUp actions for new page:', JSON.stringify(action.followUp));
            chrome.storage.local.set({
              ami_pending_actions: {
                actions: action.followUp,
                url: action.url,
                ts: Date.now(),
              }
            }, () => {
              devLog('Pending actions stored, navigating now...');
              handleSearch(action.url);
            });
          } else {
            handleSearch(action.url);
          }
        }
        return;
      case 'new-tab':
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          chrome.tabs.create({ url: action.url || 'chrome://newtab', active: true });
          addMessage('system', `📑 Opened new tab${action.url ? ': ' + action.url : ''}`);
        }
        return;
      case 'close-tab':
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]) chrome.tabs.remove(tabs[0].id);
          });
        }
        return;
      case 'go-back':
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          chrome.tabs.goBack();
          addMessage('system', '⬅️ Going back');
        }
        return;
      case 'go-forward':
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          chrome.tabs.goForward();
          addMessage('system', '➡️ Going forward');
        }
        return;
      case 'reload':
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          chrome.tabs.reload();
          addMessage('system', '🔄 Reloading page');
        }
        return;
      case 'screenshot':
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ type: 'screenshot' }, resp => {
            if (resp?.dataUrl) addMessage('agent', '📸 Screenshot captured!');
            else addMessage('system', 'Could not capture screenshot.');
          });
        }
        return;
      case 'open-settings':
        openModal('settings');
        return;
      case 'open-connections':
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          chrome.tabs.create({ url: chrome.runtime.getURL('connections.html') });
        }
        return;
      case 'toggle-theme':
        document.body.classList.toggle('dark-theme');
        addMessage('system', '🎨 Theme toggled');
        return;
      case 'fullscreen':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
        return;
      case 'clear-chat':
        dom.chatMessages.innerHTML = '';
        chatHistory = [];
        storeSet(STORE_KEYS.chatHist, []);
        addMessage('system', 'Chat cleared.');
        return;
      case 'open-hub':
        // Already on hub
        addMessage('system', 'You are already on the AMI Hub page.');
        return;
      case 'bookmark':
        if (typeof chrome !== 'undefined' && chrome.bookmarks) {
          chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]) {
              chrome.bookmarks.create({ title: tabs[0].title, url: tabs[0].url });
              addMessage('agent', `🔖 Bookmarked: ${tabs[0].title}`);
            }
          });
        }
        return;
      case 'schedule':
        if (action.task) {
          dom.cronTask.value = action.task;
          if (action.name) dom.cronName.value = action.name;
          openModal('cron');
        }
        return;
      case 'remember':
        storeGet('ami_memory', []).then(mem => {
          mem.push({ text: action.text, ts: Date.now() });
          storeSet('ami_memory', mem);
          addMessage('agent', `🧠 Remembered: "${action.text}"`);
        });
        return;
      case 'recall':
        storeGet('ami_memory', []).then(mem => {
          if (!mem.length) { addMessage('agent', '🧠 No memories stored yet.'); return; }
          if (action.query) {
            const q = action.query.toLowerCase();
            const matches = mem.filter(m => m.text.toLowerCase().includes(q));
            if (matches.length) {
              addMessage('agent', `🧠 Memories matching "${action.query}":\n${matches.map(m => `• ${m.text}`).join('\n')}`);
            } else {
              addMessage('agent', `🧠 No memories matching "${action.query}"`);
            }
          } else {
            addMessage('agent', `🧠 All memories (${mem.length}):\n${mem.slice(-20).map(m => `• ${m.text}`).join('\n')}`);
          }
        });
        return;
      case 'forget':
        storeSet('ami_memory', []);
        addMessage('agent', '🧠 All memories cleared.');
        return;
      case 'save-note':
        storeGet('ami_notes', []).then(notes => {
          notes.push({ text: action.text, ts: Date.now() });
          storeSet('ami_notes', notes);
          addMessage('agent', `📝 Note saved.`);
        });
        return;
      case 'list-notes':
        storeGet('ami_notes', []).then(notes => {
          if (!notes.length) { addMessage('agent', '📝 No notes yet.'); return; }
          addMessage('agent', `📝 Notes (${notes.length}):\n${notes.map((n, i) => `${i + 1}. ${n.text}`).join('\n')}`);
        });
        return;
      case 'list-skills':
        addMessage('agent', `🛠️ ${allSkills.length} skills available. Check the Skills Library in the left panel, or ask me about a specific category.`);
        return;
      case 'show-history':
        const recent = chatHistory.slice(-10);
        addMessage('agent', `📜 Recent chat (${recent.length} messages):\n${recent.map(m => `${m.role}: ${m.text.slice(0, 80)}`).join('\n')}`);
        return;
      case 'export-chat':
        const blob = new Blob([chatHistory.map(m => `[${m.role}] ${m.text}`).join('\n\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ami-chat-${new Date().toISOString().slice(0,10)}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        addMessage('agent', '💾 Chat exported.');
        return;
      case 'status':
        checkServices();
        addMessage('agent', `Status: Gateway ${dom.pillGw.classList.contains('offline') ? '❌ offline' : '✅ online'}, MCP ${dom.pillMcp.classList.contains('offline') ? '❌ offline' : '✅ online'}, Skills: ${allSkills.length}, Automations: ${crons.length}`);
        return;
      case 'version':
        addMessage('agent', 'AMI Browser v2.0 — AI-powered automation workspace');
        return;
    }

    // Default: forward to background service worker
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'execute-action', action });
    }
  });
  stats.tasks += actions.length;
  storeSet(STORE_KEYS.stats, stats);
  renderStats();
}

/* ── API call via gateway proxy (uses saved connection credentials) ── */
async function executeApiCallAction(action) {
  addMessage('system', `🔗 Calling API: ${action.method || 'GET'} ${action.url}`);
  try {
    const resp = await fetch(`${GW_HTTP}/api/proxy-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: action.connectionId,
        provider: action.provider,
        url: action.url,
        method: action.method || 'GET',
        headers: action.headers,
        body: action.body,
      }),
    });
    const result = await resp.json();
    if (result.ok) {
      const preview = typeof result.data === 'string' ? result.data.slice(0, 300) : JSON.stringify(result.data).slice(0, 300);
      addMessage('agent', `API response (${result.status}):\n\`\`\`json\n${preview}\n\`\`\``);
    } else {
      addMessage('system', `API call failed: ${result.error || result.status}`);
    }
  } catch (err) {
    addMessage('system', `API call error: ${err.message}`);
  }
}

/* ── Cookie grab via background service worker ── */
async function executeCookieGrabAction(action) {
  addMessage('system', `🍪 Grabbing cookies for: ${action.domain || 'current tab'}`);
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({ type: 'get-cookies', domain: action.domain }, response => {
      if (response?.cookies?.length) {
        addMessage('agent', `Got ${response.cookies.length} cookies for ${action.domain || 'current tab'}. Session data captured for automation.`);
      } else {
        addMessage('system', `No cookies found for ${action.domain || 'current tab'}.`);
      }
    });
  }
}

/* ══════════════════════════════════════
   WebSocket relay connection
   ══════════════════════════════════════ */
function connectRelay() {
  try {
    wsRelay = new WebSocket(GW_WS);
    wsRelay.onopen = () => {
      dom.pillGw.classList.remove('offline');
    };
    wsRelay.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'agent-reply') {
          hideThinking();
          addMessage('agent', msg.text);
          agentBusy = false;
          dom.agentStatus.textContent = 'Ready';
        } else if (msg.type === 'page-visited') {
          stats.pages++;
          storeSet(STORE_KEYS.stats, stats);
          renderStats();
        }
      } catch { /* ignore non-JSON */ }
    };
    wsRelay.onclose = () => {
      dom.pillGw.classList.add('offline');
      setTimeout(connectRelay, 5000);
    };
    wsRelay.onerror = () => {
      dom.pillGw.classList.add('offline');
    };
  } catch {
    dom.pillGw.classList.add('offline');
    setTimeout(connectRelay, 5000);
  }
}

/* ══════════════════════════════════════
   Service health checks
   ══════════════════════════════════════ */
async function checkServices() {
  // Gateway
  try {
    const r = await fetch(`${GW_HTTP}/health`, { signal: AbortSignal.timeout(2000) });
    dom.pillGw.classList.toggle('offline', !r.ok);
  } catch {
    dom.pillGw.classList.add('offline');
  }

  // MCP
  try {
    const r = await fetch(`${MCP_HTTP}/health`, { signal: AbortSignal.timeout(2000) });
    dom.pillMcp.classList.toggle('offline', !r.ok);
  } catch {
    dom.pillMcp.classList.add('offline');
  }

  // Re-check every 15s
  setTimeout(checkServices, 15000);
}

/* ══════════════════════════════════════
   Config
   ══════════════════════════════════════ */
function loadConfig() {
  if (config.provider) dom.llmProvider.value = config.provider;
  if (config.apiKey)   dom.llmApiKey.value = config.apiKey;
  if (config.url)      dom.llmUrl.value = config.url;
  if (config.model)    dom.llmModel.value = config.model;
  if (config.systemPrompt) dom.systemPrompt.value = config.systemPrompt;
  if (config.autoExec !== undefined) dom.cfgAutoexec.checked = config.autoExec;
  if (config.showThinking !== undefined) dom.cfgThinking.checked = config.showThinking;
  updateConfigVisibility();
}

function saveConfig() {
  config = {
    provider:     dom.llmProvider.value,
    apiKey:       dom.llmApiKey.value,
    url:          dom.llmUrl.value,
    model:        dom.llmModel.value,
    systemPrompt: dom.systemPrompt.value,
    autoExec:     dom.cfgAutoexec.checked,
    showThinking: dom.cfgThinking.checked,
  };
  storeSet(STORE_KEYS.config, config);
  addMessage('system', 'Configuration saved.');
}

function updateConfigVisibility() {
  const prov = dom.llmProvider.value;
  const show = (sel, cond) => { const el = $(sel); if (el) el.classList.toggle('cfg-hidden', !cond); };
  const needsKey = ['openai','anthropic','gemini','mistral','grok','deepseek','openrouter','huggingface','custom'].includes(prov);
  show('#cfg-api-key', needsKey);
  show('#cfg-url',     prov === 'ollama' || prov === 'custom');
  show('#cfg-model',   prov !== 'none');
}

/* ══════════════════════════════════════
   Modals
   ══════════════════════════════════════ */
function openModal(name) {
  dom.modalOverlay.classList.remove('hidden');
  if (name === 'cron') dom.modalCron.classList.remove('hidden');
  if (name === 'settings') dom.modalSettings.classList.remove('hidden');
}

function closeModals() {
  dom.modalOverlay.classList.add('hidden');
  dom.modalCron.classList.add('hidden');
  dom.modalSettings.classList.add('hidden');
}

/* ══════════════════════════════════════
   Skills Library (fetched from gateway)
   ══════════════════════════════════════ */
let allSkills = [];

async function loadSkillsLibrary(retries = 3) {
  try {
    const resp = await fetch(`${GW_HTTP}/api/skills`);
    const data = await resp.json();
    allSkills = data.skills || [];

    // Update badges
    const totalBadge = document.getElementById('skill-total-badge');
    if (totalBadge) totalBadge.textContent = data.total || allSkills.length;
    const countMsg = document.getElementById('skill-count-msg');
    if (countMsg) countMsg.textContent = `${data.total || allSkills.length}`;

    renderSkillCategories();
    renderSkillsList(allSkills);
    bindSkillsSearch();
  } catch {
    if (retries > 0) {
      setTimeout(() => loadSkillsLibrary(retries - 1), 2000);
      return;
    }
    const list = document.getElementById('skills-list');
    if (list) list.innerHTML = '<div class="empty-state">Gateway offline — start gateway to load skills</div>';
  }
}

function renderSkillCategories() {
  const container = document.getElementById('skills-categories');
  if (!container) return;

  // Get unique categories with counts
  const cats = {};
  allSkills.forEach(s => { cats[s.cat] = (cats[s.cat] || 0) + 1; });

  container.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'skill-cat-btn active';
  allBtn.textContent = `All (${allSkills.length})`;
  allBtn.addEventListener('click', () => {
    container.querySelectorAll('.skill-cat-btn').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active');
    renderSkillsList(allSkills);
  });
  container.appendChild(allBtn);

  Object.entries(cats).forEach(([cat, count]) => {
    const btn = document.createElement('button');
    btn.className = 'skill-cat-btn';
    btn.textContent = `${cat} (${count})`;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.skill-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderSkillsList(allSkills.filter(s => s.cat === cat));
    });
    container.appendChild(btn);
  });
}

function renderSkillsList(skills) {
  const container = document.getElementById('skills-list');
  if (!container) return;

  if (!skills.length) {
    container.innerHTML = '<div class="empty-state">No matching skills</div>';
    return;
  }

  container.innerHTML = '';
  skills.forEach(skill => {
    const el = document.createElement('div');
    el.className = 'skill-item';
    el.innerHTML = `<span class="skill-id">${escHtml(skill.id)}</span><span class="skill-desc">${escHtml(skill.desc)}</span>`;
    el.title = `Click to use: ${skill.id}`;
    el.addEventListener('click', () => {
      dom.chatInput.value = skill.id.replace(/-/g, ' ');
      dom.chatInput.focus();
      autoResizeInput();
    });
    container.appendChild(el);
  });
}

function bindSkillsSearch() {
  const input = document.getElementById('skills-search');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    if (!q) {
      renderSkillsList(allSkills);
      return;
    }
    const filtered = allSkills.filter(s =>
      s.id.toLowerCase().includes(q) ||
      s.desc.toLowerCase().includes(q) ||
      s.cat.toLowerCase().includes(q)
    );
    renderSkillsList(filtered);
  });
}

/* ══════════════════════════════════════
   Event bindings
   ══════════════════════════════════════ */
function bindEvents() {
  // Search bar
  dom.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSearch(dom.searchInput.value);
  });

  // Chat send
  dom.btnSend.addEventListener('click', sendChat);
  dom.chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  dom.chatInput.addEventListener('input', autoResizeInput);

  // Chat tools
  dom.btnClearChat.addEventListener('click', () => {
    dom.chatMessages.innerHTML = '';
    chatHistory = [];
    storeSet(STORE_KEYS.chatHist, []);
    addMessage('system', 'Chat cleared. Ask me anything!');
  });
  dom.btnAttach.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs[0]) {
          const t = tabs[0];
          dom.chatInput.value += `\n[tab: ${t.title} — ${t.url}]`;
          dom.chatInput.focus();
          autoResizeInput();
        }
      });
    }
  });
  dom.btnScreenshot.addEventListener('click', () => {
    dom.chatInput.value = 'screenshot';
    sendChat();
  });
  dom.btnCron.addEventListener('click', () => openModal('cron'));

  // Cron modal
  dom.btnNewCron.addEventListener('click', () => openModal('cron'));
  dom.btnCreateCron.addEventListener('click', createCron);
  dom.cronFreq.addEventListener('change', () => {
    dom.cronCustom.classList.toggle('cfg-hidden', dom.cronFreq.value !== 'custom');
  });

  // Settings
  dom.btnSettings.addEventListener('click', () => openModal('settings'));

  // Config
  dom.llmProvider.addEventListener('change', updateConfigVisibility);
  dom.btnSaveConfig.addEventListener('click', saveConfig);

  // Modal close buttons
  $$('[data-close]').forEach(btn => btn.addEventListener('click', closeModals));
  dom.modalOverlay.addEventListener('click', e => {
    if (e.target === dom.modalOverlay) closeModals();
  });

  // Add shortcut
  dom.btnAddShortcut.addEventListener('click', () => {
    const url = prompt('URL:');
    if (!url) return;
    const label = prompt('Label:', new URL(url.startsWith('http') ? url : `https://${url}`).hostname);
    if (!label) return;
    storeGet(STORE_KEYS.shortcuts, DEFAULT_SHORTCUTS).then(shortcuts => {
      shortcuts.push({ label, url: url.startsWith('http') ? url : `https://${url}`, icon: '🔗', bg: '#e9d5ff' });
      storeSet(STORE_KEYS.shortcuts, shortcuts);
      renderShortcuts(shortcuts);
    });
  });
}

/* ── Auto-resize textarea ── */
function autoResizeInput() {
  dom.chatInput.style.height = 'auto';
  dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 120) + 'px';
}

/* ── HTML escape ── */
function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* ══════════════════════════════════════
   Provider dropdown population
   ══════════════════════════════════════ */
const ALL_PROVIDERS = [
  { id: 'none',        label: '— Select a provider —' },
  { id: 'openai',      label: 'OpenAI' },
  { id: 'anthropic',   label: 'Anthropic' },
  { id: 'gemini',      label: 'Google Gemini' },
  { id: 'mistral',     label: 'Mistral' },
  { id: 'grok',        label: 'xAI Grok' },
  { id: 'deepseek',    label: 'DeepSeek' },
  { id: 'openrouter',  label: 'OpenRouter' },
  { id: 'huggingface', label: 'HuggingFace' },
  { id: 'ollama',      label: 'Ollama (local)' },
  { id: 'custom',      label: 'Custom endpoint' },
];

function populateProviderDropdown() {
  dom.llmProvider.innerHTML = '';
  ALL_PROVIDERS.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    dom.llmProvider.appendChild(opt);
  });
}

/* ══════════════════════════════════════
   Model refresh (live catalog fetch)
   ══════════════════════════════════════ */
async function refreshModels() {
  const prov = dom.llmProvider.value;
  const key = dom.llmApiKey.value.trim();
  if (!prov || prov === 'none') return;

  dom.llmModel.innerHTML = '<option>Loading…</option>';
  try {
    const resp = await fetch(`${GW_HTTP}/api/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: prov, apiKey: key }),
    });
    const data = await resp.json();
    dom.llmModel.innerHTML = '';
    if (data.models && data.models.length) {
      data.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        dom.llmModel.appendChild(opt);
      });
      if (config.model) dom.llmModel.value = config.model;
    } else {
      dom.llmModel.innerHTML = '<option>No models found</option>';
    }
  } catch {
    dom.llmModel.innerHTML = '<option>Failed to load</option>';
  }
}

/* ══════════════════════════════════════
   Speech-to-text (microphone)
   ══════════════════════════════════════ */
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

async function toggleMic() {
  if (isRecording) {
    stopRecording();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      dom.btnMic.classList.remove('recording');
      dom.btnMic.title = 'Speech to text';
      isRecording = false;

      addMessage('system', '🎙️ Transcribing audio…');
      try {
        const resp = await fetch(`${GW_HTTP}/api/stt`, {
          method: 'POST',
          body: blob,
        });
        const data = await resp.json();
        if (data.text) {
          dom.chatInput.value = data.text;
          dom.chatInput.focus();
          autoResizeInput();
          // Auto-send transcribed text (Voxtral is accurate enough)
          sendChat();
        } else {
          addMessage('system', 'Could not transcribe audio.');
        }
      } catch {
        addMessage('system', 'STT failed. Check gateway is running and MISTRAL_API_KEY is set in .env');
      }
    };
    mediaRecorder.start();
    isRecording = true;
    dom.btnMic.classList.add('recording');
    dom.btnMic.title = 'Stop recording (click again)';
  } catch (err) {
    addMessage('system', `Microphone access denied: ${err.message}`);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

/* ══════════════════════════════════════
   Text-to-speech (speak last reply)
   ══════════════════════════════════════ */
async function speakLastReply() {
  const agentMsgs = chatHistory.filter(m => m.role === 'agent');
  if (!agentMsgs.length) { addMessage('system', 'No agent reply to read.'); return; }
  const lastText = agentMsgs[agentMsgs.length - 1].text;
  addMessage('system', '🔊 Generating speech…');

  try {
    const resp = await fetch(`${GW_HTTP}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lastText }),
    });
    if (!resp.ok) throw new Error(`TTS ${resp.status}`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
    audio.onended = () => URL.revokeObjectURL(url);
  } catch {
    addMessage('system', 'TTS failed. Check gateway is running and MISTRAL_API_KEY is set in .env');
  }
}

/* ══════════════════════════════════════
   Pause toggle
   ══════════════════════════════════════ */
function bindPauseToggle() {
  const pauseCheckbox = $('#cfg-pause');
  const pausePill = $('#pill-pause');
  if (!pauseCheckbox) return;

  // Load initial state
  storeGet('ami_browser_paused', false).then(paused => {
    pauseCheckbox.checked = paused;
    if (pausePill) {
      pausePill.querySelector('.pill-dot')?.classList.toggle('paused', paused);
      pausePill.childNodes[pausePill.childNodes.length - 1].textContent = paused ? ' Paused' : ' Active';
    }
  });

  pauseCheckbox.addEventListener('change', () => {
    const paused = pauseCheckbox.checked;
    storeSet('ami_browser_paused', paused);
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'pause-automation', paused });
    }
    if (pausePill) {
      pausePill.querySelector('.pill-dot')?.classList.toggle('paused', paused);
      pausePill.childNodes[pausePill.childNodes.length - 1].textContent = paused ? ' Paused' : ' Active';
    }
  });
}

/* ══════════════════════════════════════
   Connections page navigation
   ══════════════════════════════════════ */
function bindConnections() {
  const btn1 = $('#btn-open-connections');
  const btn2 = $('#btn-open-connections-side');
  const handler = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: chrome.runtime.getURL('connections.html') });
    } else {
      window.open('connections.html', '_blank');
    }
  };
  if (btn1) btn1.addEventListener('click', handler);
  if (btn2) btn2.addEventListener('click', handler);
}

/* ══════════════════════════════════════
   Late bindings (called after DOMContentLoaded init)
   ══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  populateProviderDropdown();
  const refreshBtn = $('#btn-refresh-models');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshModels);
  const micBtn = $('#btn-mic');
  if (micBtn) micBtn.addEventListener('click', toggleMic);
  const ttsBtn = $('#btn-tts');
  if (ttsBtn) ttsBtn.addEventListener('click', speakLastReply);
  bindPauseToggle();
  bindConnections();

  // Auto-refresh model list when provider changes
  dom.llmProvider.addEventListener('change', () => {
    updateConfigVisibility();
    refreshModels();
  });
});

/* ══════════════════════════════════════
   Persona status (full page at persona.html)
   ══════════════════════════════════════ */
const PERSONA_FIELDS = ['name','firstName','lastName','email','phone','company','jobTitle','address','city','zip','country','website','bio','skills','education','languages'];

async function loadPersona() {
  const persona = await storeGet('ami_persona', {});
  const status = document.getElementById('persona-status');
  if (!status) return;
  const filled = Object.values(persona).filter(Boolean).length;
  status.textContent = filled ? `${filled} fields filled` : 'Not configured — click to set up';
}

/* ══════════════════════════════════════
   Memory viewer (persistent local memory)
   ══════════════════════════════════════ */
async function loadMemoryViewer() {
  const mem = await storeGet('ami_memory', []);
  renderMemoryList(mem);

  const search = document.getElementById('memory-search');
  if (search) {
    search.addEventListener('input', async () => {
      const allMem = await storeGet('ami_memory', []);
      const q = search.value.toLowerCase().trim();
      renderMemoryList(q ? allMem.filter(m => m.text.toLowerCase().includes(q)) : allMem);
    });
  }

  const exportBtn = document.getElementById('btn-export-memory');
  if (exportBtn) exportBtn.addEventListener('click', async () => {
    const allMem = await storeGet('ami_memory', []);
    const blob = new Blob([JSON.stringify(allMem, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ami-memory-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addMessage('system', '💾 Memory exported.');
  });

  const clearBtn = document.getElementById('btn-clear-memory');
  if (clearBtn) clearBtn.addEventListener('click', async () => {
    if (!confirm('Clear all agent memories? This cannot be undone.')) return;
    await storeSet('ami_memory', []);
    renderMemoryList([]);
    addMessage('system', '🧠 All memories cleared.');
  });
}

function renderMemoryList(memories) {
  const list = document.getElementById('memory-list');
  const badge = document.getElementById('memory-count-badge');
  if (!list) return;
  if (badge) badge.textContent = memories.length;

  if (!memories.length) {
    list.innerHTML = '<div class="empty-state">No memories yet. Say "remember …" in chat.</div>';
    return;
  }

  list.innerHTML = '';
  memories.slice().reverse().forEach((m, idx) => {
    const realIdx = memories.length - 1 - idx;
    const el = document.createElement('div');
    el.className = 'memory-item';
    const time = m.ts ? new Date(m.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    el.innerHTML = `
      <div class="memory-item-text">
        ${escHtml(m.text)}
        ${m.source ? `<div class="memory-item-source">${escHtml(m.source)}</div>` : ''}
      </div>
      <span class="memory-item-time">${time}</span>
      <button class="memory-item-del" data-idx="${realIdx}" title="Delete">&times;</button>
    `;
    el.querySelector('.memory-item-del').addEventListener('click', async () => {
      const allMem = await storeGet('ami_memory', []);
      allMem.splice(realIdx, 1);
      await storeSet('ami_memory', allMem);
      renderMemoryList(allMem);
    });
    list.appendChild(el);
  });
}

// Refresh memory viewer when memories change via chat
const _origRememberHandler = null;
chrome.storage?.onChanged?.addListener((changes) => {
  if (changes.ami_memory) {
    const mem = changes.ami_memory.newValue || [];
    renderMemoryList(mem);
  }
});

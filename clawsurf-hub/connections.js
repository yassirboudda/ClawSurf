'use strict';

const GW_HTTP = 'http://127.0.0.1:18789';

/* ── DOM refs ── */
const categoriesEl  = document.getElementById('connection-categories');
const gridEl        = document.getElementById('connections-grid');
const savedEl       = document.getElementById('saved-connections');
const overlayEl     = document.getElementById('modal-overlay');
const modalEl       = document.getElementById('connection-modal');
const titleEl       = document.getElementById('connection-title');
const nameEl        = document.getElementById('connection-name');
const secretEl      = document.getElementById('connection-secret');
const metaEl        = document.getElementById('connection-meta');
const btnNext       = document.getElementById('btn-next');
const btnBack       = document.getElementById('btn-back');
const btnTest       = document.getElementById('btn-test-connection');
const testResultEl  = document.getElementById('test-result');
const modelSearchEl = document.getElementById('model-search');
const modelDropEl   = document.getElementById('model-dropdown');
const modelSourceEl = document.getElementById('model-source');
const modelValEl    = document.getElementById('selected-model');
const providerCountEl = document.getElementById('provider-count');
const savedCountEl    = document.getElementById('saved-count');
const searchInputEl   = document.getElementById('provider-search');

/* ── State ── */
let connectionTypes = [];
let activeProvider  = null;
let currentStep     = 1;
let testPassed      = false;
let allModels       = [];
let activeCategory  = null;

/* AI provider kinds that support model picking */
const AI_KINDS = new Set(['llm', 'stt', 'tts', 'image', 'embedding', 'ai', 'voice']);
const AI_PROVIDER_IDS = new Set([
  'openai', 'anthropic', 'gemini', 'mistral', 'grok', 'deepseek',
  'openrouter', 'huggingface', 'ollama', 'together', 'replicate',
  'perplexity', 'cohere', 'ai21', 'fireworks', 'groq', 'cerebras',
]);
function isAIProvider(provider) {
  if (!provider) return false;
  return AI_KINDS.has((provider.kind || '').toLowerCase()) ||
         AI_PROVIDER_IDS.has(provider.id);
}

/* ── Provider brand icons (inline SVG data URIs, same CDN as hub shortcuts) ── */
const PROVIDER_ICONS = {
  openai:      'https://cdn.simpleicons.org/openai',
  anthropic:   'https://cdn.simpleicons.org/anthropic',
  gemini:      'https://cdn.simpleicons.org/googlegemini',
  mistral:     "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23F7931E'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='42' fill='white'%3EM%3C/text%3E%3C/svg%3E",
  grok:        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23000'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3E%F0%9D%95%8F%3C/text%3E%3C/svg%3E",
  deepseek:    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%234D6BFE'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3EDS%3C/text%3E%3C/svg%3E",
  openrouter:  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%236C3AED'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3EOR%3C/text%3E%3C/svg%3E",
  huggingface: 'https://cdn.simpleicons.org/huggingface',
  ollama:      'https://cdn.simpleicons.org/ollama',
  together:    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%230FA37F'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3ET%3C/text%3E%3C/svg%3E",
  replicate:   "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23262626'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3ER%3C/text%3E%3C/svg%3E",
  perplexity:  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%2320808D'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3Eai%3C/text%3E%3C/svg%3E",
  cohere:      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%2339594D'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='42' fill='white'%3EC%3C/text%3E%3C/svg%3E",
  ai21:        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23FF6F61'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='32' fill='white'%3EA21%3C/text%3E%3C/svg%3E",
  fireworks:   "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23FF4F00'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='42' fill='white'%3EF%3C/text%3E%3C/svg%3E",
  groq:        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23F55036'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='42' fill='white'%3EG%3C/text%3E%3C/svg%3E",
  cerebras:    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%231E40AF'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3ECB%3C/text%3E%3C/svg%3E",
  runpod:      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%235C2D91'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3ERP%3C/text%3E%3C/svg%3E",
  lmstudio:    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%2310B981'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='32' fill='white'%3ELM%3C/text%3E%3C/svg%3E",
  elevenlabs:  'https://cdn.simpleicons.org/elevenlabs',
  stability:   "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%237C3AED'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3ESD%3C/text%3E%3C/svg%3E",
  midjourney:  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23000'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3EMJ%3C/text%3E%3C/svg%3E",
  whisper:     'https://cdn.simpleicons.org/openai',
  deepgram:    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%2313EF93'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='%23000'%3EDG%3C/text%3E%3C/svg%3E",
  assemblyai:  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%233B82F6'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3EAA%3C/text%3E%3C/svg%3E",
  pinecone:    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23000'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='32' fill='white'%3E%F0%9F%8C%B2%3C/text%3E%3C/svg%3E",
  telegram:    'https://cdn.simpleicons.org/telegram',
  discord:     'https://cdn.simpleicons.org/discord',
  whatsapp:    'https://cdn.simpleicons.org/whatsapp',
  slack:       'https://cdn.simpleicons.org/slack',
  github:      'https://cdn.simpleicons.org/github',
  zapier:      'https://cdn.simpleicons.org/zapier',
  make:        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%236D00CC'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3EM%3C/text%3E%3C/svg%3E",
  notion:      'https://cdn.simpleicons.org/notion',
  airtable:    'https://cdn.simpleicons.org/airtable',
  supabase:    'https://cdn.simpleicons.org/supabase',
  firebase:    'https://cdn.simpleicons.org/firebase',
  mongodb:     'https://cdn.simpleicons.org/mongodb',
  redis:       'https://cdn.simpleicons.org/redis',
  postgresql:  'https://cdn.simpleicons.org/postgresql',
  mysql:       'https://cdn.simpleicons.org/mysql',
  aws:         'https://cdn.simpleicons.org/amazonaws',
  gcp:         'https://cdn.simpleicons.org/googlecloud',
  azure:       'https://cdn.simpleicons.org/microsoftazure',
  stripe:      'https://cdn.simpleicons.org/stripe',
  twilio:      'https://cdn.simpleicons.org/twilio',
  sendgrid:    'https://cdn.simpleicons.org/twilio',
};

function getProviderIcon(id) {
  return PROVIDER_ICONS[id] || PROVIDER_ICONS[id.replace(/^(stt_|tts_)/, '')] ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%239333EA'/%3E%3Ctext x='50' y='66' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' font-size='36' fill='white'%3E" + encodeURIComponent(id.charAt(0).toUpperCase()) + "%3C/text%3E%3C/svg%3E";
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', async () => {
  bindModal();
  await Promise.all([loadProviders(), loadConnections()]);
  searchInputEl.addEventListener('input', renderProviderGrid);

  // Back to hub button
  const backBtn = document.getElementById('btn-back-hub');
  if (backBtn) backBtn.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      window.location.href = chrome.runtime.getURL('hub.html');
    } else {
      window.location.href = 'hub.html';
    }
  });
});

/* ──────────────── Provider Grid ──────────────── */
async function loadProviders() {
  const response = await fetch(`${GW_HTTP}/api/providers`);
  const data = await response.json();
  connectionTypes = data.providers || [];

  /* Category chips with counts */
  const catCounts = {};
  connectionTypes.forEach(p => { catCounts[p.category] = (catCounts[p.category] || 0) + 1; });
  const categories = [...new Set(connectionTypes.map(p => p.category))];
  categoriesEl.innerHTML = `<span class="cat-chip active" data-cat="">All <span class="cat-count">${connectionTypes.length}</span></span>` +
    categories.map(c => `<span class="cat-chip" data-cat="${escapeHtml(c)}">${escapeHtml(c)} <span class="cat-count">${catCounts[c]}</span></span>`).join('');

  [...categoriesEl.querySelectorAll('.cat-chip')].forEach(pill => {
    pill.addEventListener('click', () => {
      categoriesEl.querySelector('.cat-chip.active')?.classList.remove('active');
      pill.classList.add('active');
      activeCategory = pill.dataset.cat || null;
      renderProviderGrid();
    });
  });

  renderProviderGrid();
}

function renderProviderGrid() {
  const query = (searchInputEl.value || '').toLowerCase();
  const filtered = connectionTypes.filter(p => {
    if (activeCategory && p.category !== activeCategory) return false;
    if (query && !p.label.toLowerCase().includes(query) &&
        !p.id.toLowerCase().includes(query) &&
        !p.category.toLowerCase().includes(query) &&
        !(p.description || '').toLowerCase().includes(query)) return false;
    return true;
  });
  providerCountEl.textContent = `(${filtered.length} of ${connectionTypes.length})`;

  gridEl.innerHTML = filtered.map(provider => `
    <button class="card" data-provider="${escapeHtml(provider.id)}" style="text-align:left;cursor:pointer;padding:14px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="${getProviderIcon(provider.id)}" alt="" width="32" height="32" style="border-radius:8px;flex-shrink:0;" onerror="this.style.display='none'">
          <div>
            <strong>${escapeHtml(provider.label)}</strong>
            <div class="about-text">${escapeHtml(provider.category)}</div>
          </div>
        </div>
        <span class="integration-pill">${escapeHtml(provider.kind)}</span>
      </div>
      <p class="about-text" style="margin-top:10px;">${escapeHtml(provider.description)}</p>
    </button>
  `).join('');

  [...gridEl.querySelectorAll('[data-provider]')].forEach(button => {
    button.addEventListener('click', () => openModal(button.dataset.provider));
  });
}

/* ──────────────── Saved Connections ──────────────── */
async function loadConnections() {
  const response = await fetch(`${GW_HTTP}/api/connections`);
  const data = await response.json();
  const items = data.connections || [];
  savedCountEl.textContent = `(${items.length})`;
  if (!items.length) {
    savedEl.innerHTML = '<div class="empty-state">No connections saved yet.</div>';
    return;
  }

  savedEl.innerHTML = items.map(c => {
    const status = c.status || 'untested';
    const statusLabel = status === 'active' ? 'Connected' : status === 'error' ? 'Error' : 'Untested';
    return `
    <div class="cron-item" style="margin-bottom:10px;">
      <img src="${getProviderIcon(c.provider)}" alt="" width="28" height="28" style="border-radius:6px;flex-shrink:0;margin-right:8px;" onerror="this.style.display='none'">
      <div class="cron-info" style="flex:1;">
        <div class="cron-name"><span class="conn-status ${escapeHtml(status)}" title="${statusLabel}"></span>${escapeHtml(c.name)}</div>
        <div class="cron-schedule">${escapeHtml(c.provider)}${c.model ? ' · ' + escapeHtml(c.model) : ''} · ${escapeHtml(c.updatedAt || '')}</div>
      </div>
      <button class="btn-ghost btn-retest" data-retest="${escapeHtml(c.id)}" data-provider="${escapeHtml(c.provider)}" title="Re-test" style="padding:4px 8px;display:flex;align-items:center;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      </button>
      <button class="btn-ghost" data-delete="${escapeHtml(c.id)}" title="Delete connection" style="color:#e74c4c;padding:4px 8px;display:flex;align-items:center;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>`;
  }).join('');

  [...savedEl.querySelectorAll('[data-delete]')].forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`${GW_HTTP}/api/connections/${encodeURIComponent(btn.dataset.delete)}`, { method: 'DELETE' });
      await loadConnections();
    });
  });

  [...savedEl.querySelectorAll('[data-retest]')].forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
      const connId = btn.dataset.retest;
      const res = await fetch(`${GW_HTTP}/api/connections/${encodeURIComponent(connId)}/secret`);
      const secretData = await res.json();
      const testRes = await fetch(`${GW_HTTP}/api/connections/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: btn.dataset.provider, secret: secretData.secret || '', connectionId: connId }),
      });
      const testData = await testRes.json();
      btn.innerHTML = testData.ok
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      setTimeout(() => { btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>'; }, 3000);
      await loadConnections();
    });
  });
}

/* ──────────────── Modal / Step Logic ──────────────── */
function bindModal() {
  document.querySelectorAll('[data-close]').forEach(btn =>
    btn.addEventListener('click', closeModal));
  overlayEl.addEventListener('click', e => {
    if (e.target === overlayEl) closeModal();
  });
  btnNext.addEventListener('click', handleNext);
  btnBack.addEventListener('click', handleBack);
  btnTest.addEventListener('click', runTest);
  modelSearchEl.addEventListener('input', filterModels);
  modelSearchEl.addEventListener('focus', () => modelDropEl.classList.add('open'));
  document.addEventListener('click', e => {
    if (!e.target.closest('.model-picker')) modelDropEl.classList.remove('open');
  });
}

function openModal(providerId) {
  activeProvider = connectionTypes.find(p => p.id === providerId) || null;
  titleEl.textContent = activeProvider ? `New ${activeProvider.label} connection` : 'New connection';
  nameEl.value = '';
  secretEl.value = '';
  metaEl.value = '';
  testPassed = false;
  allModels = [];
  modelValEl.value = '';
  modelSearchEl.value = '';
  modelDropEl.innerHTML = '';
  modelSourceEl.textContent = '';
  testResultEl.className = 'test-result';
  testResultEl.textContent = '';
  goToStep(1);
  overlayEl.classList.remove('hidden');
  modalEl.classList.remove('hidden');
  nameEl.focus();
}

function closeModal() {
  overlayEl.classList.add('hidden');
  modalEl.classList.add('hidden');
  activeProvider = null;
}

function goToStep(step) {
  currentStep = step;
  for (let i = 1; i <= 3; i++) {
    document.getElementById(`step-${i}`).classList.toggle('active', i === step);
    const dot = document.getElementById(`step-dot-${i}`);
    dot.classList.remove('active', 'done');
    if (i < step) dot.classList.add('done');
    else if (i === step) dot.classList.add('active');
    if (i < 3) {
      document.getElementById(`step-line-${i}`).classList.toggle('done', i < step);
    }
  }
  btnBack.style.display = step > 1 ? '' : 'none';
  if (step === 1) {
    btnNext.textContent = 'Next →';
    btnNext.disabled = false;
  } else if (step === 2) {
    btnNext.textContent = 'Next →';
    btnNext.disabled = !testPassed;
  } else if (step === 3) {
    btnNext.textContent = '💾 Save Connection';
    btnNext.disabled = false;
    setupStep3();
  }
}

function handleNext() {
  if (currentStep === 1) {
    if (!nameEl.value.trim() || !secretEl.value.trim()) {
      nameEl.reportValidity();
      return;
    }
    goToStep(2);
  } else if (currentStep === 2) {
    if (!testPassed) return;
    goToStep(3);
  } else if (currentStep === 3) {
    saveConnection();
  }
}

function handleBack() {
  if (currentStep > 1) goToStep(currentStep - 1);
}

/* ──────────────── Step 2: Test connection ──────────────── */
async function runTest() {
  if (!activeProvider) return;
  testResultEl.className = 'test-result loading';
  testResultEl.textContent = '⏳ Testing connection…';
  btnTest.disabled = true;
  btnNext.disabled = true;
  testPassed = false;

  try {
    const res = await fetch(`${GW_HTTP}/api/connections/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: activeProvider.id,
        secret: secretEl.value.trim(),
        metadata: metaEl.value.trim(),
      }),
    });
    const data = await res.json();
    if (data.ok) {
      testPassed = true;
      testResultEl.className = 'test-result success';
      testResultEl.textContent = '✅ Connection verified! ' + (data.message || '');
      btnNext.disabled = false;
    } else {
      testResultEl.className = 'test-result error';
      testResultEl.textContent = '❌ ' + (data.error || 'Test failed');
    }
  } catch (err) {
    testResultEl.className = 'test-result error';
    testResultEl.textContent = '❌ Network error: ' + err.message;
  }
  btnTest.disabled = false;
}

/* ──────────────── Step 3: Model picker ──────────────── */
function setupStep3() {
  const pickerSection  = document.getElementById('model-picker-section');
  const noModelSection = document.getElementById('no-model-section');

  if (isAIProvider(activeProvider)) {
    pickerSection.style.display = '';
    noModelSection.style.display = 'none';
    fetchModels();
  } else {
    pickerSection.style.display = 'none';
    noModelSection.style.display = '';
  }
}

async function fetchModels() {
  modelSourceEl.textContent = '⏳ Loading models…';
  modelDropEl.innerHTML = '';
  allModels = [];

  try {
    const res = await fetch(`${GW_HTTP}/api/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: activeProvider.id,
        apiKey: secretEl.value.trim(),
        metadata: metaEl.value.trim(),
      }),
    });
    const data = await res.json();
    allModels = (data.models || []).map(m => typeof m === 'string' ? { id: m } : m);
    if (allModels.length) {
      modelSourceEl.textContent = `${allModels.length} models loaded from ${activeProvider.label}`;
    } else {
      modelSourceEl.textContent = 'No models returned. You can type a model ID manually.';
    }
  } catch {
    modelSourceEl.textContent = 'Could not fetch models. Type a model ID manually.';
  }
  renderModelList();
}

function renderModelList() {
  const query = (modelSearchEl.value || '').toLowerCase();
  const filtered = allModels.filter(m =>
    m.id.toLowerCase().includes(query) ||
    (m.name || '').toLowerCase().includes(query)
  ).slice(0, 80);

  modelDropEl.innerHTML = filtered.map(m => `
    <div class="model-item" data-model="${escapeHtml(m.id)}">
      <div class="model-id">${escapeHtml(m.id)}</div>
    </div>
  `).join('');

  [...modelDropEl.querySelectorAll('.model-item')].forEach(el => {
    el.addEventListener('click', () => {
      modelValEl.value = el.dataset.model;
      modelSearchEl.value = el.dataset.model;
      modelDropEl.classList.remove('open');
    });
  });
}

function filterModels() {
  modelValEl.value = modelSearchEl.value;
  renderModelList();
  modelDropEl.classList.add('open');
}

/* ──────────────── Save ──────────────── */
async function saveConnection() {
  if (!activeProvider) return;
  const payload = {
    provider: activeProvider.id,
    name: nameEl.value.trim(),
    secret: secretEl.value.trim(),
    metadata: metaEl.value.trim(),
  };
  if (modelValEl.value) payload.model = modelValEl.value;
  if (!payload.name || !payload.secret) return;

  btnNext.disabled = true;
  btnNext.textContent = 'Saving…';
  await fetch(`${GW_HTTP}/api/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  closeModal();
  await loadConnections();
}

/* ── Helpers ── */
function escapeHtml(value) {
  if (value == null) return '';
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}
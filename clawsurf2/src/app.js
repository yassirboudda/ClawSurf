/* ═══════════════════════════════════════════════════
   ClawSurf 2.0 — Renderer (app.js)
   ═══════════════════════════════════════════════════ */

(() => {
  'use strict';

  /* ── State ── */
  const tabs = [];
  let activeTabId = null;
  let tabCounter = 0;
  const agentConfig = {
    provider: 'none',
    apiKey: '',
    url: '',
    model: '',
    systemPrompt: '',
    autoExecute: true,
    showThinking: false,
  };

  /* ── DOM refs ── */
  const $ = (s) => document.querySelector(s);
  const tabsContainer = $('#tabs-container');
  const webviewContainer = $('#webview-container');
  const welcomePage = $('#welcome-page');
  const urlInput = $('#url-input');
  const sslIcon = $('#url-ssl-icon');
  const statusText = $('#status-text');
  const chatMessages = $('#chat-messages');
  const chatInput = $('#chat-input');

  /* ═══ WINDOW CONTROLS ═══ */
  $('#btn-min').onclick = () => window.clawsurf.minimize();
  $('#btn-max').onclick = () => window.clawsurf.maximize();
  $('#btn-close').onclick = () => window.clawsurf.close();

  /* ═══ SIDEBAR ═══ */
  const railBtns = document.querySelectorAll('.rail-btn[data-panel]');
  const panels = document.querySelectorAll('.panel');
  const sidebar = $('#sidebar');

  railBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const panelId = btn.dataset.panel;
      railBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      panels.forEach(p => p.classList.toggle('active', p.id === `panel-${panelId}`));
      if (sidebar.classList.contains('collapsed')) {
        sidebar.classList.remove('collapsed');
      }
    });
  });

  $('#btn-toggle-sidebar').onclick = () => {
    sidebar.classList.toggle('collapsed');
  };

  /* ═══ TABS ═══ */
  function createTab(url = '') {
    const id = ++tabCounter;
    const wv = document.createElement('webview');
    wv.id = `wv-${id}`;
    wv.setAttribute('partition', 'persist:clawsurf2');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('webpreferences', 'contextIsolation=yes');

    if (url) {
      wv.src = url.startsWith('http') ? url : `https://${url}`;
    }

    const tab = {
      id,
      title: url ? new URL(wv.src).hostname : 'New Tab',
      url: wv.src || '',
      favicon: '',
      loading: false,
      webview: wv,
      wcId: null,
    };
    tabs.push(tab);

    // Webview events
    wv.addEventListener('dom-ready', () => {
      tab.wcId = wv.getWebContentsId();
    });
    wv.addEventListener('did-start-loading', () => {
      tab.loading = true;
      renderTab(tab);
      if (tab.id === activeTabId) statusText.textContent = 'Loading…';
    });
    wv.addEventListener('did-stop-loading', () => {
      tab.loading = false;
      renderTab(tab);
      if (tab.id === activeTabId) statusText.textContent = 'Ready';
    });
    wv.addEventListener('did-navigate', (_e) => {
      tab.url = wv.getURL();
      if (tab.id === activeTabId) updateUrlBar(tab);
    });
    wv.addEventListener('did-navigate-in-page', () => {
      tab.url = wv.getURL();
      if (tab.id === activeTabId) updateUrlBar(tab);
    });
    wv.addEventListener('page-title-updated', (e) => {
      tab.title = e.title || 'Untitled';
      renderTab(tab);
    });
    wv.addEventListener('page-favicon-updated', (e) => {
      if (e.favicons && e.favicons.length > 0) {
        tab.favicon = e.favicons[0];
        renderTab(tab);
      }
    });
    wv.addEventListener('new-window', (e) => {
      createTab(e.url);
    });

    webviewContainer.appendChild(wv);
    activateTab(id);
    renderTabs();
    return tab;
  }

  function activateTab(id) {
    activeTabId = id;
    tabs.forEach(t => {
      t.webview.classList.toggle('active', t.id === id);
    });
    const tab = tabs.find(t => t.id === id);
    if (tab) {
      updateUrlBar(tab);
      welcomePage.classList.add('hidden');
    }
    renderTabs();
  }

  function closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tab = tabs[idx];
    tab.webview.remove();
    tabs.splice(idx, 1);

    if (tabs.length === 0) {
      activeTabId = null;
      urlInput.value = '';
      welcomePage.classList.remove('hidden');
    } else if (activeTabId === id) {
      const newIdx = Math.min(idx, tabs.length - 1);
      activateTab(tabs[newIdx].id);
    }
    renderTabs();
  }

  function renderTabs() {
    tabsContainer.innerHTML = '';
    for (const tab of tabs) {
      const el = document.createElement('div');
      el.className = `tab${tab.id === activeTabId ? ' active' : ''}${tab.loading ? ' tab-loading' : ''}`;
      el.innerHTML = `
        ${tab.favicon
          ? `<img class="tab-favicon" src="${escHtml(tab.favicon)}" alt="">`
          : `<svg class="tab-favicon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`
        }
        <span class="tab-title">${escHtml(tab.title)}</span>
        <button class="tab-close" data-id="${tab.id}">✕</button>
      `;
      el.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tab-close')) activateTab(tab.id);
      });
      el.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });
      tabsContainer.appendChild(el);
    }
  }

  function renderTab(tab) {
    const el = tabsContainer.querySelector(`.tab[data-tabid="${tab.id}"]`);
    // Just re-render all tabs for simplicity
    renderTabs();
  }

  function updateUrlBar(tab) {
    urlInput.value = tab.url;
    try {
      const u = new URL(tab.url);
      sslIcon.classList.toggle('secure', u.protocol === 'https:');
    } catch {
      sslIcon.classList.remove('secure');
    }
  }

  /* ─── Navigation ─── */
  $('#btn-new-tab').onclick = () => createTab();
  $('#btn-back').onclick = () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) tab.webview.goBack();
  };
  $('#btn-forward').onclick = () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) tab.webview.goForward();
  };
  $('#btn-reload').onclick = () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) tab.webview.reload();
  };

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      let val = urlInput.value.trim();
      if (!val) return;

      // Detect if it's a URL or search query
      if (!/^https?:\/\//i.test(val)) {
        if (/^[\w-]+\.\w{2,}/.test(val)) {
          val = 'https://' + val;
        } else {
          val = `https://www.google.com/search?q=${encodeURIComponent(val)}`;
        }
      }

      const tab = tabs.find(t => t.id === activeTabId);
      if (tab) {
        tab.webview.loadURL(val);
      } else {
        createTab(val);
      }
    }
  });

  /* Quick links */
  document.querySelectorAll('.quick-link').forEach(btn => {
    btn.addEventListener('click', () => createTab(btn.dataset.url));
  });

  /* ═══ CHAT ═══ */
  function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.innerHTML = formatMessage(content);
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function formatMessage(text) {
    // Simple markdown: **bold**, `code`, ```code blocks```
    return text
      .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  addMessage('system', 'ClawSurf 2.0 ready. Type a command or ask the agent to automate a task.');

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });
  // Auto-resize textarea
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });
  $('#chat-send').onclick = sendChat;

  async function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    chatInput.style.height = 'auto';
    addMessage('user', text);

    // Parse and execute commands
    await handleCommand(text);
  }

  async function handleCommand(text) {
    const lower = text.toLowerCase();
    const tab = tabs.find(t => t.id === activeTabId);
    const wcId = tab?.wcId;

    // ── Navigate ──
    const navMatch = lower.match(/^(?:go to|navigate to|open|visit)\s+(.+)/);
    if (navMatch) {
      let url = navMatch[1].trim();
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      addMessage('agent', `<span class="action-tag">NAVIGATE</span>\nNavigating to **${escHtml(url)}**…`);
      if (tab && wcId) {
        await window.clawsurf.navigate(wcId, url);
      } else {
        createTab(url);
      }
      return;
    }

    // ── Click ──
    const clickMatch = lower.match(/^click\s+(?:on\s+)?(.+)/);
    if (clickMatch && wcId) {
      const selector = clickMatch[1].trim();
      addMessage('agent', `<span class="action-tag">CLICK</span>\nClicking on \`${escHtml(selector)}\`…`);
      const res = await window.clawsurf.click(wcId, selector);
      if (!res.ok) addMessage('agent', `Error: ${res.error}`);
      else addMessage('agent', 'Done ✓');
      return;
    }

    // ── Type ──
    const typeMatch = lower.match(/^type\s+"([^"]+)"\s+(?:in|into)\s+(.+)/);
    if (typeMatch && wcId) {
      const [, textToType, selector] = typeMatch;
      addMessage('agent', `<span class="action-tag">TYPE</span>\nTyping into \`${escHtml(selector)}\`…`);
      const res = await window.clawsurf.type(wcId, selector.trim(), textToType);
      if (!res.ok) addMessage('agent', `Error: ${res.error}`);
      else addMessage('agent', 'Done ✓');
      return;
    }

    // ── Screenshot ──
    if (/^(?:screenshot|capture|snap)/.test(lower) && wcId) {
      addMessage('agent', `<span class="action-tag">SCREENSHOT</span>\nCapturing page…`);
      const res = await window.clawsurf.screenshot(wcId);
      if (res.ok) {
        addMessage('agent', `<img src="${res.dataUrl}" style="max-width:100%;border-radius:6px;margin-top:4px">`);
      } else {
        addMessage('agent', `Error: ${res.error}`);
      }
      return;
    }

    // ── Get HTML / Read page ──
    if (/^(?:read|get html|get page|what.s on|describe)/.test(lower) && wcId) {
      addMessage('agent', `<span class="action-tag">READ</span>\nReading page content…`);
      const res = await window.clawsurf.getHtml(wcId);
      if (res.ok) {
        const preview = res.html.substring(0, 500) + (res.html.length > 500 ? '…' : '');
        addMessage('agent', `\`\`\`\n${escHtml(preview)}\n\`\`\``);
      } else {
        addMessage('agent', `Error: ${res.error}`);
      }
      return;
    }

    // ── Scroll ──
    if (/^scroll\s+(down|up)/.test(lower) && wcId) {
      const dir = lower.includes('down') ? 500 : -500;
      addMessage('agent', `<span class="action-tag">SCROLL</span>\nScrolling ${dir > 0 ? 'down' : 'up'}…`);
      await window.clawsurf.execute(wcId, 'Runtime.evaluate', {
        expression: `window.scrollBy(0, ${dir})`,
      });
      addMessage('agent', 'Done ✓');
      return;
    }

    // ── Help ──
    if (/^(?:help|commands|\?)/.test(lower)) {
      addMessage('agent', `**Available commands:**
• \`go to <url>\` — navigate to a URL
• \`click <selector>\` — click an element
• \`type "<text>" in <selector>\` — type into an input
• \`screenshot\` — capture the current page
• \`read\` — get page HTML content
• \`scroll down/up\` — scroll the page
• \`new tab\` — open a new tab
• \`help\` — show this message`);
      return;
    }

    // ── New tab ──
    if (/^new tab/.test(lower)) {
      createTab();
      addMessage('agent', 'New tab opened.');
      return;
    }

    // ── Unknown ──
    addMessage('agent', `I don't understand that command yet. Type \`help\` to see available commands.\n\nWhen an LLM provider is configured in **Agent Config**, I'll be able to understand natural language requests.`);
  }

  /* ═══ AGENT CONFIG ═══ */
  const providerSelect = $('#llm-provider');
  const apiKeySection = $('#api-key-section');
  const customUrlSection = $('#custom-url-section');
  const modelSection = $('#model-section');

  providerSelect.addEventListener('change', () => {
    const val = providerSelect.value;
    apiKeySection.style.display = (val === 'openai' || val === 'anthropic') ? '' : 'none';
    customUrlSection.style.display = (val === 'ollama' || val === 'custom') ? '' : 'none';
    modelSection.style.display = val !== 'none' ? '' : 'none';

    if (val === 'ollama') {
      $('#llm-url').value = 'http://localhost:11434/v1';
      $('#llm-model').placeholder = 'llama3';
    } else if (val === 'openai') {
      $('#llm-model').placeholder = 'gpt-4o';
    } else if (val === 'anthropic') {
      $('#llm-model').placeholder = 'claude-sonnet-4-20250514';
    }
  });

  $('#save-agent-config').onclick = () => {
    agentConfig.provider = providerSelect.value;
    agentConfig.apiKey = $('#llm-api-key').value;
    agentConfig.url = $('#llm-url').value;
    agentConfig.model = $('#llm-model').value;
    agentConfig.systemPrompt = $('#agent-system-prompt').value;
    agentConfig.autoExecute = $('#auto-execute').checked;
    agentConfig.showThinking = $('#show-thinking').checked;

    // Persist to localStorage
    localStorage.setItem('clawsurf2-agent-config', JSON.stringify(agentConfig));
    addMessage('system', 'Agent configuration saved.');
  };

  // Load saved config
  try {
    const saved = JSON.parse(localStorage.getItem('clawsurf2-agent-config'));
    if (saved) {
      Object.assign(agentConfig, saved);
      providerSelect.value = agentConfig.provider;
      $('#llm-api-key').value = agentConfig.apiKey;
      $('#llm-url').value = agentConfig.url;
      $('#llm-model').value = agentConfig.model;
      $('#agent-system-prompt').value = agentConfig.systemPrompt;
      $('#auto-execute').checked = agentConfig.autoExecute;
      $('#show-thinking').checked = agentConfig.showThinking;
      providerSelect.dispatchEvent(new Event('change'));
    }
  } catch {}

  /* ═══ STATUS CHECK ═══ */
  async function checkGateway() {
    try {
      const res = await window.clawsurf.gatewayStatus();
      $('#gateway-dot').classList.add('ok');
      $('#gateway-dot').classList.remove('err');
      $('#fw-badge').textContent = 'active';
      $('#fw-badge').className = 'badge badge-ok';
    } catch {
      $('#gateway-dot').classList.add('err');
      $('#gateway-dot').classList.remove('ok');
      $('#fw-badge').textContent = 'inactive';
      $('#fw-badge').className = 'badge badge-warn';
    }
  }
  checkGateway();
  setInterval(checkGateway, 5000);

  /* ═══ UTILS ═══ */
  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /* ═══ KEYBOARD SHORTCUTS ═══ */
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 't') { e.preventDefault(); createTab(); }
    if (e.ctrlKey && e.key === 'w') { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
    if (e.ctrlKey && e.key === 'l') { e.preventDefault(); urlInput.focus(); urlInput.select(); }
    if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab) tab.webview.reload();
    }
  });

  /* ═══ INIT ═══ */
  // Start with welcome page visible
  console.log('[clawsurf2] Renderer ready');
})();

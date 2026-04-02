/* AMI Browser – Content inject: floating action button + full chat + page context */
'use strict';

(() => {
  if (location.protocol === 'chrome-extension:' || location.protocol === 'chrome:') return;

  /* ── Dev logging ── */
  function devLog(...args) {
    console.log(`%c[AMI-fab]`, 'color:#f9a8d4;font-weight:bold', ...args);
  }

  /* ── State ── */
  let expanded = false;
  let chatHistory = [];

  /* ── FAB (Floating Action Button) ── */
  const fab = document.createElement('div');
  fab.id = 'ami-browser-fab';
  fab.innerHTML = `<img src="${chrome.runtime.getURL('icons/icon32.png')}" alt="AMI Browser">`;
  document.documentElement.appendChild(fab);

  fab.addEventListener('click', () => {
    expanded ? hideMiniChat() : showMiniChat();
    expanded = !expanded;
  });

  /* ── Keyboard shortcut: Ctrl+Shift+A ── */
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      expanded ? hideMiniChat() : showMiniChat();
      expanded = !expanded;
    }
    if (e.key === 'Escape' && expanded) {
      hideMiniChat();
      expanded = false;
    }
  });

  /* ── Show mini chat panel ── */
  function showMiniChat() {
    let panel = document.getElementById('ami-browser-mini');
    if (panel) { panel.style.display = 'flex'; focusInput(); return; }

    panel = document.createElement('div');
    panel.id = 'ami-browser-mini';
    panel.innerHTML = `
      <div class="csm-header">
        <div class="csm-header-left">
          <img src="${chrome.runtime.getURL('icons/icon16.png')}" alt="" class="csm-logo">
          <span>AMI Agent</span>
          <span class="csm-skill-count"></span>
        </div>
        <div class="csm-header-btns">
          <button id="csm-hub" title="Open AMI Hub (full page)">⬡</button>
          <button id="csm-context" title="Send page context">📄</button>
          <button id="csm-extract" title="Extract page data">📋</button>
          <button id="csm-close" title="Close (Esc)">&times;</button>
        </div>
      </div>
      <div id="csm-suggestions">
        <button class="csm-chip" data-cmd="summarize this page">Summarize page</button>
        <button class="csm-chip" data-cmd="extract links">Extract links</button>
        <button class="csm-chip" data-cmd="extract emails">Find emails</button>
        <button class="csm-chip" data-cmd="fill form">Fill form</button>
        <button class="csm-chip" data-cmd="screenshot">Screenshot</button>
        <button class="csm-chip" data-cmd="extract text">Read page</button>
      </div>
      <div id="csm-messages"></div>
      <div class="csm-composer">
        <input id="csm-input" type="text" placeholder="Ask AMI Agent… (Ctrl+Shift+A)">
        <button id="csm-send" title="Send">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    `;
    document.documentElement.appendChild(panel);

    // Event listeners
    document.getElementById('csm-close').addEventListener('click', () => { hideMiniChat(); expanded = false; });
    document.getElementById('csm-send').addEventListener('click', miniSend);
    document.getElementById('csm-input').addEventListener('keydown', e => { if (e.key === 'Enter') miniSend(); });
    document.getElementById('csm-hub').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'open-hub' });
    });
    document.getElementById('csm-context').addEventListener('click', sendPageContext);
    document.getElementById('csm-extract').addEventListener('click', () => miniSendText('extract text'));

    // Skill suggestion chips
    panel.querySelectorAll('.csm-chip').forEach(chip => {
      chip.addEventListener('click', () => miniSendText(chip.dataset.cmd));
    });

    // Load skill count
    fetchSkillCount();

    // Greet
    addMiniMsg('agent', `Hi! I'm AMI Agent on this page. Ask me to extract data, fill forms, automate actions, or anything else. ${getPageSummary()}`);
    focusInput();
  }

  function hideMiniChat() {
    const p = document.getElementById('ami-browser-mini');
    if (p) p.style.display = 'none';
  }

  function focusInput() {
    setTimeout(() => {
      const input = document.getElementById('csm-input');
      if (input) input.focus();
    }, 100);
  }

  /* ── Page context helpers ── */
  function getPageSummary() {
    const title = document.title || '';
    const desc = document.querySelector('meta[name="description"]')?.content || '';
    const url = location.href;
    return `\n\n📍 **Current page:** ${title}\n${desc ? desc.slice(0, 100) + '…' : url}`;
  }

  function getPageContext() {
    const title = document.title;
    const url = location.href;
    const desc = document.querySelector('meta[name="description"]')?.content || '';
    const selected = window.getSelection()?.toString() || '';
    const headings = [...document.querySelectorAll('h1, h2, h3')].slice(0, 10).map(h => h.textContent.trim());
    const forms = document.querySelectorAll('form').length;
    const links = document.querySelectorAll('a[href]').length;
    const images = document.querySelectorAll('img').length;

    return { title, url, desc, selected, headings, forms, links, images };
  }

  function sendPageContext() {
    const ctx = getPageContext();
    let text = `📍 **Page Context:**\n`;
    text += `Title: ${ctx.title}\nURL: ${ctx.url}\n`;
    if (ctx.desc) text += `Description: ${ctx.desc}\n`;
    if (ctx.selected) text += `\nSelected text: "${ctx.selected.slice(0, 200)}"\n`;
    if (ctx.headings.length) text += `\nHeadings: ${ctx.headings.join(' | ')}\n`;
    text += `\nForms: ${ctx.forms} | Links: ${ctx.links} | Images: ${ctx.images}`;
    addMiniMsg('agent', text);
  }

  async function fetchSkillCount() {
    try {
      const resp = await fetch('http://127.0.0.1:18789/api/skills');
      const data = await resp.json();
      const badge = document.querySelector('.csm-skill-count');
      if (badge) badge.textContent = `${data.total} skills`;
    } catch { /* gateway offline */ }
  }

  /* ── Chat helpers ── */
  function addMiniMsg(role, text) {
    const msgs = document.getElementById('csm-messages');
    if (!msgs) return;
    const d = document.createElement('div');
    d.className = `csm-msg csm-${role}`;
    d.innerHTML = formatMiniText(text);
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    chatHistory.push({ role, text });
  }

  function formatMiniText(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
      .replace(/\n/g, '<br>');
  }

  function fabAutoRemember(userMsg, agentReply) {
    const trivial = /^(hi|hello|hey|thanks|ok|yes|no|bye|sure|got it)\b/i;
    if (trivial.test(userMsg.trim()) && agentReply.length < 120) return;
    if (/^⚠|^Gateway|^Error/i.test(agentReply)) return;
    const pageUrl = location.href;
    const summary = `[${document.title.slice(0, 60)}] Q: ${userMsg.slice(0, 200)}\nA: ${agentReply.slice(0, 300)}`;
    chrome.storage.local.get('ami_memory', d => {
      let mem = d.ami_memory || [];
      if (mem.length && mem[mem.length - 1].text && mem[mem.length - 1].text.includes(userMsg.slice(0, 50))) return;
      mem.push({ text: summary, ts: Date.now(), source: 'auto-fab', url: pageUrl });
      if (mem.length > 500) mem = mem.slice(-500);
      chrome.storage.local.set({ ami_memory: mem });
    });
  }

  function miniSendText(text) {
    const input = document.getElementById('csm-input');
    if (input) { input.value = text; miniSend(); }
  }

  function miniSend() {
    const input = document.getElementById('csm-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    addMiniMsg('user', text);

    // Send page context along with the message for smarter responses
    const ctx = getPageContext();
    const payload = {
      message: text,
      source: 'fab',
      pageContext: {
        title: ctx.title,
        url: ctx.url,
        selected: ctx.selected,
        headings: ctx.headings,
        forms: ctx.forms,
        links: ctx.links,
      }
    };

    // Show typing indicator
    const msgs = document.getElementById('csm-messages');
    const typing = document.createElement('div');
    typing.className = 'csm-msg csm-agent csm-typing';
    typing.innerHTML = '<span class="csm-dots"><span>.</span><span>.</span><span>.</span></span>';
    msgs.appendChild(typing);
    msgs.scrollTop = msgs.scrollHeight;

    fetch('http://127.0.0.1:18789/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    .then(r => r.json())
    .then(data => {
      typing.remove();
      const reply = data.reply || data.message || JSON.stringify(data);
      addMiniMsg('agent', reply);

      // Execute any returned actions on the page
      if (data.actions) executePageActions(data.actions);

      // Auto-memory: save exchange to local memory
      fabAutoRemember(text, reply);
    })
    .catch(() => {
      typing.remove();
      addMiniMsg('agent', '⚠️ Gateway offline. Start it with: `node gateway.js`');
    });
  }

  /* ── Execute actions on the current page ── */
  function executePageActions(actions) {
    if (!Array.isArray(actions)) return;
    for (const action of actions) {
      switch (action.type) {
        case 'navigate':
          if (action.url) window.location.href = action.url;
          break;
        case 'click': {
          const el = findElement(action.selector);
          if (el) { highlightElement(el); setTimeout(() => el.click(), 300); addMiniMsg('agent', `✅ Clicked: ${el.textContent?.trim().slice(0, 60) || action.selector}`); }
          else addMiniMsg('agent', `⚠️ Could not find element: "${action.selector}". Try being more specific or use a CSS selector.`);
          break;
        }
        case 'type': {
          const el = findElement(action.selector);
          if (el) { highlightElement(el); el.focus(); el.value = action.text; el.dispatchEvent(new Event('input', { bubbles: true })); addMiniMsg('agent', `✅ Typed into: ${action.selector}`); }
          else addMiniMsg('agent', `⚠️ Could not find input: "${action.selector}"`);
          break;
        }
        case 'scroll':
          window.scrollBy(0, action.y || 300);
          break;
        case 'scroll-to':
          window.scrollTo(0, action.y || 0);
          break;
        case 'highlight': {
          const el = findElement(action.selector);
          if (el) highlightElement(el);
          break;
        }
        case 'extract-text': {
          const text = document.body.innerText.slice(0, 3000);
          addMiniMsg('agent', `📄 Page text (first 3000 chars):\n\`\`\`\n${text}\n\`\`\``);
          break;
        }
        case 'extract-links': {
          const links = [...document.querySelectorAll('a[href]')].slice(0, 50).map(a => `${a.textContent.trim().slice(0, 50)} → ${a.href}`);
          addMiniMsg('agent', `🔗 Links found (${links.length}):\n${links.join('\n')}`);
          break;
        }
        case 'extract-emails': {
          const text = document.body.innerText;
          const emails = [...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [])];
          addMiniMsg('agent', emails.length ? `📧 Emails found: ${emails.join(', ')}` : '📧 No emails found on this page');
          break;
        }
        case 'extract-images': {
          const imgs = [...document.querySelectorAll('img[src]')].slice(0, 20).map(i => i.src);
          addMiniMsg('agent', `🖼️ Images found (${imgs.length}):\n${imgs.join('\n')}`);
          break;
        }
        case 'extract-table': {
          const table = document.querySelector('table');
          if (!table) { addMiniMsg('agent', 'No table found on this page'); break; }
          const rows = [...table.querySelectorAll('tr')].slice(0, 20).map(tr =>
            [...tr.querySelectorAll('td, th')].map(c => c.textContent.trim()).join(' | ')
          );
          addMiniMsg('agent', `📊 Table data:\n${rows.join('\n')}`);
          break;
        }
        case 'extract-headings': {
          const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => `${h.tagName}: ${h.textContent.trim()}`);
          addMiniMsg('agent', headings.length ? `📑 Headings:\n${headings.join('\n')}` : 'No headings found');
          break;
        }
        case 'extract-meta': {
          const meta = {
            title: document.title,
            description: document.querySelector('meta[name="description"]')?.content || '',
            keywords: document.querySelector('meta[name="keywords"]')?.content || '',
            author: document.querySelector('meta[name="author"]')?.content || '',
            canonical: document.querySelector('link[rel="canonical"]')?.href || '',
          };
          addMiniMsg('agent', `🏷️ Metadata:\n${Object.entries(meta).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n')}`);
          break;
        }
        case 'extract-prices': {
          const text = document.body.innerText;
          const prices = [...new Set(text.match(/[$€£¥][\d,.]+|\d+[.,]\d{2}\s*(?:USD|EUR|GBP|ETH|BTC)/gi) || [])];
          addMiniMsg('agent', prices.length ? `💰 Prices found: ${prices.join(', ')}` : '💰 No prices found');
          break;
        }
        case 'extract-phones': {
          const text = document.body.innerText;
          const phones = [...new Set(text.match(/(?:\+\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g) || [])];
          addMiniMsg('agent', phones.length ? `📱 Phones found: ${phones.join(', ')}` : '📱 No phone numbers found');
          break;
        }
        case 'extract-selected': {
          const sel = window.getSelection()?.toString();
          addMiniMsg('agent', sel ? `Selected: "${sel}"` : 'No text selected');
          break;
        }
        case 'extract-forms': {
          const forms = [...document.querySelectorAll('form')];
          if (!forms.length) { addMiniMsg('agent', 'No forms found'); break; }
          const info = forms.map((f, i) => {
            const inputs = [...f.querySelectorAll('input, select, textarea')].map(inp =>
              `  ${inp.tagName.toLowerCase()}[name="${inp.name || ''}"] type="${inp.type || ''}" placeholder="${inp.placeholder || ''}"`
            );
            return `Form ${i + 1} (${f.action || 'no action'}):\n${inputs.join('\n')}`;
          });
          addMiniMsg('agent', `📝 Forms:\n${info.join('\n\n')}`);
          break;
        }
        case 'fill-form': {
          const forms = document.querySelectorAll('form');
          if (!forms.length) { addMiniMsg('agent', 'No form found to fill'); break; }
          // Auto-fill visible inputs — try explicit data first, then persona
          chrome.storage.local.get('ami_persona', d => {
            const persona = d.ami_persona || {};
            const fieldMap = {
              name: ['name', 'full_name', 'fullname', 'your-name', 'customer_name'],
              firstName: ['first_name', 'firstname', 'fname', 'given-name', 'prenom'],
              lastName: ['last_name', 'lastname', 'lname', 'family-name', 'nom'],
              email: ['email', 'e-mail', 'mail', 'your-email', 'customer_email'],
              phone: ['phone', 'tel', 'telephone', 'mobile', 'cell'],
              company: ['company', 'organization', 'org', 'business'],
              address: ['address', 'street', 'addr', 'address1'],
              city: ['city', 'town', 'locality'],
              zip: ['zip', 'postal', 'postcode', 'zipcode'],
              country: ['country', 'nation'],
              website: ['website', 'url', 'site', 'homepage'],
            };
            let filled = 0;
            forms[0].querySelectorAll('input, select, textarea').forEach(inp => {
              if (inp.type === 'hidden' || inp.type === 'submit' || inp.type === 'button') return;
              if (inp.value) return;
              const key = (inp.name || inp.id || inp.placeholder || '').toLowerCase();
              const autocomp = (inp.autocomplete || '').toLowerCase();
              // Try explicit data first
              if (action.data && typeof action.data === 'object' && action.data[inp.name]) {
                inp.value = action.data[inp.name];
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                highlightElement(inp);
                filled++;
                return;
              }
              // Then try persona data
              for (const [field, aliases] of Object.entries(fieldMap)) {
                if (persona[field] && (aliases.some(a => key.includes(a)) || autocomp.includes(field))) {
                  inp.value = persona[field];
                  inp.dispatchEvent(new Event('input', { bubbles: true }));
                  inp.dispatchEvent(new Event('change', { bubbles: true }));
                  highlightElement(inp);
                  filled++;
                  break;
                }
              }
            });
            addMiniMsg('agent', filled ? `✅ Filled ${filled} fields` : (() => {
              const hasPersona = Object.values(persona).filter(Boolean).length > 0;
              if (!hasPersona) {
                const personaUrl = chrome.runtime.getURL('persona.html');
                return `Form detected but no persona data. <a href="${personaUrl}" target="_blank" style="color:#7c3aed;font-weight:600">Set up your Persona</a> to enable auto-filling.`;
              }
              return 'Form detected but no fields matched your persona data.';
            })());
          });
          break;
        }
        case 'run-js': {
          // Sandboxed execution - only report result, don't eval arbitrary code from network
          addMiniMsg('agent', '⚠️ Direct JS execution is restricted for security. Use specific action types instead.');
          break;
        }
        case 'submit': {
          const form = document.querySelector('form');
          if (form) { form.submit(); addMiniMsg('agent', 'Form submitted'); }
          else addMiniMsg('agent', 'No form found');
          break;
        }
        case 'hover': {
          const el = findElement(action.selector);
          if (el) { highlightElement(el); el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); }
          break;
        }
        case 'select': {
          const el = findElement(action.selector);
          if (el && el.tagName === 'SELECT') {
            el.value = action.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            highlightElement(el);
          }
          break;
        }
        case 'summarize-page': {
          const text = document.body.innerText.slice(0, 5000);
          addMiniMsg('agent', `Sending page text to AI for summary…`);
          fetch('http://127.0.0.1:18789/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `Summarize this page content:\n\n${text}`, source: 'fab-summarize' }),
          })
          .then(r => r.json())
          .then(d => addMiniMsg('agent', d.reply || 'Could not summarize'))
          .catch(() => addMiniMsg('agent', '⚠️ Gateway offline'));
          break;
        }
        case 'open-hub': {
          chrome.runtime.sendMessage({ type: 'open-hub' });
          break;
        }
        case 'screenshot': {
          chrome.runtime.sendMessage({ type: 'screenshot' }, resp => {
            if (resp?.dataUrl) {
              addMiniMsg('agent', '📸 Screenshot captured!');
              // Show inline preview and download link
              const img = document.createElement('img');
              img.src = resp.dataUrl;
              img.style.cssText = 'max-width:100%;border-radius:8px;margin:4px 0;cursor:pointer';
              img.title = 'Click to download';
              img.addEventListener('click', () => {
                const a = document.createElement('a');
                a.href = resp.dataUrl;
                a.download = `ami-screenshot-${Date.now()}.png`;
                a.click();
              });
              const msgs = document.getElementById('csm-messages');
              if (msgs) { msgs.appendChild(img); msgs.scrollTop = msgs.scrollHeight; }
            } else {
              addMiniMsg('agent', '⚠️ Could not capture screenshot. Make sure the page is fully loaded.');
            }
          });
          break;
        }
        case 'screenshot-element': {
          const el = findElement(action.selector);
          if (el) {
            highlightElement(el);
            addMiniMsg('agent', `📸 Highlighted element: ${action.selector}. Full element screenshot requires DevTools.`);
          } else {
            addMiniMsg('agent', `⚠️ Could not find element: "${action.selector}"`);
          }
          break;
        }
        case 'generate-file': {
          try {
            const blob = new Blob([action.content || ''], { type: action.mime || 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = action.filename || `ami-file-${Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(url);
            addMiniMsg('agent', `💾 File generated: ${a.download}`);
          } catch (e) {
            addMiniMsg('agent', `⚠️ Could not generate file: ${e.message}`);
          }
          break;
        }
        case 'download': {
          if (action.url) {
            const a = document.createElement('a');
            a.href = action.url;
            a.download = action.filename || '';
            a.target = '_blank';
            a.click();
            addMiniMsg('agent', `⬇️ Download started: ${action.filename || action.url}`);
          }
          break;
        }
        case 'copy': {
          const text = action.text || '';
          navigator.clipboard.writeText(text).then(
            () => addMiniMsg('agent', `📋 Copied to clipboard`),
            () => addMiniMsg('agent', `⚠️ Could not copy to clipboard`)
          );
          break;
        }
        case 'wait': {
          const ms = action.ms || action.duration || 1000;
          addMiniMsg('agent', `⏳ Waiting ${ms}ms…`);
          break;
        }
        case 'remember': {
          chrome.storage.local.get('ami_memory', d => {
            const mem = d.ami_memory || [];
            mem.push({ text: action.text, ts: Date.now(), source: location.hostname });
            chrome.storage.local.set({ ami_memory: mem });
            addMiniMsg('agent', `🧠 Remembered: "${action.text}"`);
          });
          break;
        }
        case 'recall': {
          chrome.storage.local.get('ami_memory', d => {
            const mem = d.ami_memory || [];
            if (!mem.length) { addMiniMsg('agent', '🧠 No memories stored yet.'); return; }
            const q = (action.query || '').toLowerCase();
            const list = q ? mem.filter(m => m.text.toLowerCase().includes(q)) : mem.slice(-15);
            addMiniMsg('agent', `🧠 Memories (${list.length}):\n${list.map(m => `• ${m.text}`).join('\n')}`);
          });
          break;
        }
        case 'auto-fill': {
          // Use persona data from storage for smart form filling
          chrome.storage.local.get('ami_persona', d => {
            const persona = d.ami_persona || {};
            if (!Object.values(persona).filter(Boolean).length) {
              const personaUrl = chrome.runtime.getURL('persona.html');
              addMiniMsg('agent', `👤 No persona set up yet. <a href="${personaUrl}" target="_blank" style="color:#7c3aed;font-weight:600">Set up your Persona</a> first so I can auto-fill forms for you.`);
              return;
            }
            const forms = document.querySelectorAll('form');
            if (!forms.length) { addMiniMsg('agent', '⚠️ No forms found on this page'); return; }
            let filled = 0;
            const fieldMap = {
              name: ['name', 'full_name', 'fullname', 'your-name', 'username', 'customer_name'],
              firstName: ['first_name', 'firstname', 'fname', 'given-name', 'prenom'],
              lastName: ['last_name', 'lastname', 'lname', 'family-name', 'nom'],
              email: ['email', 'e-mail', 'mail', 'your-email', 'customer_email'],
              phone: ['phone', 'tel', 'telephone', 'mobile', 'cell', 'your-phone'],
              company: ['company', 'organization', 'org', 'business', 'employer'],
              jobTitle: ['job_title', 'jobtitle', 'title', 'position', 'role'],
              address: ['address', 'street', 'addr', 'address1', 'street_address'],
              city: ['city', 'town', 'locality'],
              zip: ['zip', 'postal', 'postcode', 'zipcode', 'zip_code'],
              country: ['country', 'nation'],
              website: ['website', 'url', 'site', 'homepage'],
            };
            forms.forEach(form => {
              form.querySelectorAll('input, textarea, select').forEach(inp => {
                if (inp.type === 'hidden' || inp.type === 'submit' || inp.type === 'button') return;
                if (inp.value) return;
                const key = (inp.name || inp.id || inp.placeholder || '').toLowerCase();
                const type = (inp.type || '').toLowerCase();
                const autocomp = (inp.autocomplete || '').toLowerCase();
                for (const [field, aliases] of Object.entries(fieldMap)) {
                  if (persona[field] && (aliases.some(a => key.includes(a)) || autocomp.includes(field) || type === field)) {
                    inp.value = persona[field];
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                    highlightElement(inp);
                    filled++;
                    break;
                  }
                }
              });
            });
            addMiniMsg('agent', filled ? `✅ Auto-filled ${filled} fields from your persona profile` : 'No matching fields found. Set up your persona in AMI Hub settings.');
          });
          break;
        }
        case 'show-persona': {
          chrome.storage.local.get('ami_persona', d => {
            const p = d.ami_persona || {};
            const personaUrl = chrome.runtime.getURL('persona.html');
            if (!Object.keys(p).length || !Object.values(p).filter(Boolean).length) {
              addMiniMsg('agent', `👤 No persona set up yet. <a href="${personaUrl}" target="_blank" style="color:#7c3aed;font-weight:600">Set up your Persona</a> to enable auto-filling forms.`);
              return;
            }
            const lines = Object.entries(p).filter(([,v]) => v).map(([k,v]) => `**${k}:** ${v}`);
            addMiniMsg('agent', `👤 Your Persona:\n${lines.join('\n')}\n\n<a href="${personaUrl}" target="_blank" style="color:#7c3aed;font-size:11px">Edit Persona →</a>`);
          });
          break;
        }
      }
    }
  }

  /* ── DOM helpers ── */
  function findElement(selector) {
    if (!selector) return null;

    // 0. Handle Playwright-style "text=..." selectors from LLM
    if (typeof selector === 'string' && /^text=/i.test(selector)) {
      selector = selector.replace(/^text=/i, '').trim();
    }

    // 1. Try CSS selector first
    try { const el = document.querySelector(selector); if (el) return el; } catch {}

    // 2. Handle coordinate-based clicking (from LLM: {x, y})
    if (typeof selector === 'object' && selector.x != null && selector.y != null) {
      return document.elementFromPoint(selector.x, selector.y);
    }

    // 3. Handle "nth result/link/item" patterns
    const nthMatch = selector.match(/(?:(\d+)(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)\s*(?:result|link|item|entry|option|button|element)/i);
    if (nthMatch) {
      const ordinals = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: -1 };
      let n = nthMatch[1] ? parseInt(nthMatch[1]) : ordinals[nthMatch[0].split(/\s+/)[0].toLowerCase()] || 1;

      // Google search results
      const googleResults = document.querySelectorAll('#search .g h3, #search .g a[href]:not([href^="javascript"]):not([role])');
      if (googleResults.length) {
        const idx = n === -1 ? googleResults.length - 1 : n - 1;
        if (googleResults[idx]) return googleResults[idx].closest('a') || googleResults[idx];
      }
      // Bing/DuckDuckGo results
      const bingResults = document.querySelectorAll('.b_algo h2 a, .result__a, .react-results--main a[data-testid]');
      if (bingResults.length) {
        const idx = n === -1 ? bingResults.length - 1 : n - 1;
        if (bingResults[idx]) return bingResults[idx];
      }
      // Generic: visible main links
      const mainLinks = document.querySelectorAll('main a[href], article a[href], .results a[href], [role="main"] a[href], #content a[href]');
      if (mainLinks.length) {
        const visible = [...mainLinks].filter(el => el.offsetParent !== null);
        const idx = n === -1 ? visible.length - 1 : n - 1;
        if (visible[idx]) return visible[idx];
      }
      // Fallback: body links excluding nav/header/footer
      const bodyLinks = [...document.querySelectorAll('body a[href]')].filter(
        el => el.offsetParent !== null && !el.closest('nav, header, footer, .nav, .header, .footer, [role="navigation"]')
      );
      if (bodyLinks.length) {
        const idx = n === -1 ? bodyLinks.length - 1 : n - 1;
        if (bodyLinks[idx]) return bodyLinks[idx];
      }
    }

    // 4. Exact text match on interactive elements (case-insensitive)
    const sLower = selector.toLowerCase().trim();
    const interactive = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], [tabindex]');
    // Exact match first
    for (const el of interactive) {
      if (el.offsetParent === null) continue;
      const txt = (el.textContent || '').trim().toLowerCase();
      if (txt === sLower) return el;
    }
    // Contains match
    for (const el of interactive) {
      if (el.offsetParent === null) continue;
      const txt = (el.textContent || '').trim().toLowerCase();
      if (txt.includes(sLower)) return el;
      if (el.getAttribute('aria-label')?.toLowerCase().includes(sLower)) return el;
      if (el.getAttribute('title')?.toLowerCase().includes(sLower)) return el;
      if (el.getAttribute('data-tooltip')?.toLowerCase().includes(sLower)) return el;
      if (el.getAttribute('alt')?.toLowerCase().includes(sLower)) return el;
    }

    // 5. Try by placeholder, name, id, or label
    const inputs = document.querySelectorAll('input, textarea, select');
    for (const el of inputs) {
      if (el.offsetParent === null) continue;
      if (el.placeholder?.toLowerCase().includes(sLower)) return el;
      if (el.name?.toLowerCase().includes(sLower)) return el;
      if (el.id?.toLowerCase().includes(sLower)) return el;
    }
    // Check labels
    const labels = document.querySelectorAll('label');
    for (const lbl of labels) {
      if (lbl.textContent.trim().toLowerCase().includes(sLower) && lbl.htmlFor) {
        const inp = document.getElementById(lbl.htmlFor);
        if (inp) return inp;
      }
    }

    // 6. Partial href match for links
    const links = document.querySelectorAll('a[href]');
    for (const el of links) {
      if (el.offsetParent === null) continue;
      if (el.href?.toLowerCase().includes(sLower)) return el;
    }

    // 7. DOM text-node search as last resort (visual OCR alternative)
    // Walks all visible text nodes to find elements containing the text
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        if (!node.parentElement || node.parentElement.offsetParent === null) return NodeFilter.FILTER_REJECT;
        const tag = node.parentElement.tagName;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(tag)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.toLowerCase().includes(sLower)) {
        const parent = walker.currentNode.parentElement;
        // Return the closest clickable ancestor, or the text node's parent
        return parent.closest('a, button, [role="button"], [onclick], [tabindex]') || parent;
      }
    }

    return null;
  }

  function highlightElement(el) {
    const prev = el.style.outline;
    const prevBg = el.style.backgroundColor;
    el.style.outline = '3px solid #c4b5fd';
    el.style.backgroundColor = 'rgba(196, 181, 253, 0.15)';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      el.style.outline = prev;
      el.style.backgroundColor = prevBg;
    }, 2000);
  }

  /* ══════════════════════════════════════
     Cookie consent auto-dismiss
     ══════════════════════════════════════ */
  function dismissCookieConsent() {
    devLog('Attempting to dismiss cookie consent...');
    // Common cookie consent button selectors across popular sites
    const selectors = [
      // YouTube / Google
      'button[aria-label="Accept all"]',
      'button[aria-label="Accept the use of cookies and other data for the purposes described"]',
      '[aria-label="Accept all"]',
      'form[action*="consent"] button[value="true"]',
      'tp-yt-paper-dialog #content .eom-buttons button.yt-spec-button-shape-next--filled',
      'button.yt-spec-button-shape-next--filled[aria-label*="Accept"]',
      '#yDmH0d button:last-of-type',  // Google consent
      // Generic consent patterns
      'button[id*="accept"]', 'button[id*="Accept"]',
      'button[class*="accept"]', 'button[class*="Accept"]',
      'a[id*="accept"]', 'a[class*="accept"]',
      '[data-testid="accept-button"]',
      '[data-testid*="cookie"] button',
      '.consent-bump button', '.consent-form button',
      '#CookieBoxSaveButton',
      '#onetrust-accept-btn-handler',
      '.cc-accept', '.cc-btn.cc-dismiss',
      '#didomi-notice-agree-button',
      '.cmpboxbtn.cmpboxbtnyes',
      '[class*="cookie"] button[class*="accept"]',
      '[class*="cookie"] button[class*="agree"]',
      '[class*="consent"] button[class*="accept"]',
      '[class*="consent"] button[class*="agree"]',
    ];

    for (const sel of selectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) { // visible
          devLog(`Cookie consent found via selector: "${sel}" — clicking it`);
          btn.click();
          return true;
        }
      } catch (e) { /* invalid selector, skip */ }
    }

    // Fallback: search for buttons/links by text content
    const acceptTexts = ['accept all', 'accept cookies', 'i agree', 'agree', 'allow all', 'allow cookies', 'ok', 'got it', 'consent', 'accept & continue', 'accept and continue', 'agree and proceed'];
    const allButtons = [...document.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"], input[type="submit"]')];
    for (const btn of allButtons) {
      const txt = (btn.textContent || btn.value || '').trim().toLowerCase();
      if (acceptTexts.some(at => txt === at || txt.includes(at)) && btn.offsetParent !== null) {
        devLog(`Cookie consent found by text: "${txt}" — clicking it`);
        btn.click();
        return true;
      }
    }

    devLog('No cookie consent dialog found');
    return false;
  }

  /* ══════════════════════════════════════
     Click first result (YouTube, Google, etc.)
     ══════════════════════════════════════ */
  function clickFirstResult() {
    devLog('Attempting to click first result on:', location.hostname);
    const host = location.hostname;

    // YouTube
    if (host.includes('youtube.com')) {
      // Try video renderer links
      const ytSelectors = [
        'ytd-video-renderer a#video-title',           // desktop search results
        'ytd-video-renderer h3 a',                     // alternate
        'a.ytd-video-renderer',                        // any video link
        '#contents ytd-video-renderer a#thumbnail',    // thumbnail click
        'ytd-item-section-renderer ytd-video-renderer a#video-title',
        '#dismissible a#video-title',
      ];
      for (const sel of ytSelectors) {
        const el = document.querySelector(sel);
        if (el && el.href) {
          devLog(`YouTube first result found: "${el.textContent?.trim().slice(0, 60)}" → ${el.href}`);
          highlightElement(el);
          setTimeout(() => el.click(), 500);
          return true;
        }
      }
      devLog('No YouTube video result found with known selectors');
      return false;
    }

    // Google
    if (host.includes('google.')) {
      const googleSel = '#search .g a, #rso .g a, .yuRUbf a';
      const el = document.querySelector(googleSel);
      if (el) {
        devLog(`Google first result found: "${el.textContent?.trim().slice(0, 60)}" → ${el.href}`);
        highlightElement(el);
        setTimeout(() => el.click(), 500);
        return true;
      }
      return false;
    }

    // Generic: click first major link in results area
    const generic = document.querySelector('main a[href], #content a[href], .results a[href], [role="main"] a[href]');
    if (generic) {
      devLog(`Generic first result: "${generic.textContent?.trim().slice(0, 60)}" → ${generic.href}`);
      highlightElement(generic);
      setTimeout(() => generic.click(), 500);
      return true;
    }
    return false;
  }

  /* ══════════════════════════════════════
     Pending actions: execute follow-up after navigation
     ══════════════════════════════════════ */
  function checkPendingActions() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.local.get('ami_pending_actions', data => {
      const pending = data.ami_pending_actions;
      if (!pending || !pending.actions || !pending.actions.length) return;

      // Expire stale pending actions (older than 30 seconds)
      if (Date.now() - pending.ts > 30000) {
        devLog('Pending actions expired (>30s), clearing');
        chrome.storage.local.remove('ami_pending_actions');
        return;
      }

      devLog('Found pending actions:', JSON.stringify(pending.actions));
      // Clear immediately to prevent re-execution on SPA navigations
      chrome.storage.local.remove('ami_pending_actions');

      // Execute each action with its specified delay
      pending.actions.forEach(action => {
        const delay = action.delay || 1000;
        devLog(`Scheduling action "${action.type}" with delay ${delay}ms`);

        setTimeout(() => {
          switch (action.type) {
            case 'dismiss-cookies':
              devLog('Executing: dismiss-cookies');
              dismissCookieConsent();
              // Retry once more after a short delay (some consents render late)
              setTimeout(() => dismissCookieConsent(), 1500);
              break;

            case 'click':
              devLog(`Executing: click "${action.selector}"`);
              if (action.selector === 'first result') {
                // Retry a few times since page might still be loading results
                let attempts = 0;
                const tryClick = () => {
                  attempts++;
                  devLog(`clickFirstResult attempt ${attempts}`);
                  const clicked = clickFirstResult();
                  if (!clicked && attempts < 5) {
                    setTimeout(tryClick, 1500);
                  } else if (!clicked) {
                    devLog('Failed to click first result after 5 attempts');
                  }
                };
                tryClick();
              } else {
                const el = findElement(action.selector);
                if (el) {
                  highlightElement(el);
                  setTimeout(() => el.click(), 300);
                } else {
                  devLog(`Could not find element: "${action.selector}"`);
                }
              }
              break;

            case 'type':
              devLog(`Executing: type in "${action.selector}": "${action.text}"`);
              const input = findElement(action.selector);
              if (input) {
                input.focus();
                input.value = action.text;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
              break;

            default:
              devLog(`Unknown pending action type: "${action.type}"`);
          }
        }, delay);
      });
    });
  }

  // Listen for messages from background.js to execute actions
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'execute-pending-actions' && msg.actions) {
      devLog('Received pending actions from background:', JSON.stringify(msg.actions));
      msg.actions.forEach(action => {
        const delay = action.delay || 1000;
        setTimeout(() => {
          if (action.type === 'dismiss-cookies') dismissCookieConsent();
          else if (action.type === 'click' && action.selector === 'first result') clickFirstResult();
          else if (action.type === 'click') {
            const el = findElement(action.selector);
            if (el) el.click();
          }
        }, delay);
      });
      sendResponse({ ok: true });
    }
    return false;
  });

  // Check for pending actions when page loads
  devLog('Content script loaded on:', location.href);
  if (document.readyState === 'complete') {
    checkPendingActions();
  } else {
    window.addEventListener('load', () => {
      devLog('Page load complete, checking pending actions...');
      checkPendingActions();
    });
  }

})();

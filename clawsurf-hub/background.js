/* ═══════════════════════════════════════════════════════════════
  AMI Browser – Background Service Worker
  Chrome alarms for scheduled automation, screenshot capture,
  side panel management and UI state sync
  ═══════════════════════════════════════════════════════════════ */

'use strict';

const GW_HTTP = 'http://127.0.0.1:18789';
const STORE = {
  automations: 'ami_browser_automations',
  stats: 'ami_browser_stats',
  pendingTask: 'ami_browser_pending_task',
  paused: 'ami_browser_paused',
};

/* ── Frequency → minutes ── */
const FREQ_MAP = {
  '1m': 1, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '6h': 360, '12h': 720, '1d': 1440,
};

/* ══════════════ Install / Startup ══════════════ */
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AMI Browser] Installed');
  sanitizeStartupTabs();
  chrome.storage.local.get([STORE.automations, STORE.stats, STORE.paused], data => {
    const updates = {};
    if (!Array.isArray(data[STORE.automations])) updates[STORE.automations] = [];
    if (!data[STORE.stats]) updates[STORE.stats] = { tasks: 0, pages: 0, automations: 0 };
    if (typeof data[STORE.paused] !== 'boolean') updates[STORE.paused] = false;
    if (Object.keys(updates).length) chrome.storage.local.set(updates);
  });

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'ami-browser-automate',
      title: 'Automate this with AMI Browser',
      contexts: ['page', 'selection', 'link'],
    });
  });
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[AMI Browser] Startup - restoring scheduled automation');
  sanitizeStartupTabs();
  restoreAutomationAlarms();
});

/* ── Catch new-tab creation and redirect to hub (in case chrome_url_overrides fails) ── */
chrome.tabs.onCreated.addListener(tab => {
  const url = tab.url || tab.pendingUrl || '';
  if (url === 'chrome://newtab/' || url === 'chrome://newtab' || url === '' || url === 'about:blank') {
    const hubUrl = chrome.runtime.getURL('hub.html');
    chrome.tabs.update(tab.id, { url: hubUrl });
  }
});

/* ── Also catch tab updates to NTP ── */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url === 'chrome://newtab/' || changeInfo.url === 'chrome://newtab') {
    chrome.tabs.update(tabId, { url: chrome.runtime.getURL('hub.html') });
  }
});

function sanitizeStartupTabs() {
  const hubUrl = chrome.runtime.getURL('hub.html');

  // Multiple attempts with increasing delay to catch browser's late tab creation
  [300, 800, 2000].forEach(delay => {
    setTimeout(() => {
      chrome.tabs.query({}, tabs => {
        if (!Array.isArray(tabs) || !tabs.length) return;

        const hasHub = tabs.some(t =>
          typeof t.url === 'string' && t.url === hubUrl
        );

        // Tabs that should be replaced with hub
        const junkTabs = tabs.filter(tab => {
          const url = tab.url || tab.pendingUrl || '';
          return url === 'chrome://newtab/' ||
                 url === 'chrome://newtab' ||
                 url === 'about:blank' ||
                 url === '' ||
                 url.startsWith('chrome-search://') ||
                 (url.startsWith('chrome-extension://') && url.includes('/options.html')) ||
                 (url.startsWith('chrome-extension://') && url.endsWith('/hub.html') && url !== hubUrl);
        });

        if (junkTabs.length > 0 && !hasHub) {
          // Navigate the first junk tab to hub, close the rest
          chrome.tabs.update(junkTabs[0].id, { url: hubUrl, active: true });
          for (let i = 1; i < junkTabs.length; i++) {
            if (typeof junkTabs[i].id === 'number') chrome.tabs.remove(junkTabs[i].id);
          }
        } else if (junkTabs.length > 0 && hasHub) {
          // Hub already exists, just close junk
          for (const tab of junkTabs) {
            if (typeof tab.id === 'number') chrome.tabs.remove(tab.id);
          }
        } else if (!hasHub && tabs.length === 1) {
          // Single tab but not hub - navigate it
          chrome.tabs.update(tabs[0].id, { url: hubUrl, active: true });
        }
      });
    }, delay);
  });
}

/* ══════════════ Message handler ══════════════ */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'cron-create':
      setupAutomationAlarm(msg.job);
      sendResponse({ ok: true });
      break;

    case 'cron-toggle':
      handleAutomationToggle(msg.idx, msg.enabled);
      sendResponse({ ok: true });
      break;

    case 'pause-automation':
      chrome.storage.local.set({ [STORE.paused]: !!msg.paused }, () => {
        sendResponse({ ok: true, paused: !!msg.paused });
      });
      return true;

    case 'screenshot':
      captureScreenshot().then(dataUrl => sendResponse({ dataUrl })).catch(() => sendResponse({ dataUrl: null }));
      return true; // async response

    case 'execute-action':
      executeAction(msg.action);
      sendResponse({ ok: true });
      break;

    case 'get-cookies':
      getCookiesForDomain(msg.domain).then(cookies => sendResponse({ cookies })).catch(() => sendResponse({ cookies: [] }));
      return true; // async response

    case 'api-call':
      executeApiCall(msg.payload).then(result => sendResponse(result)).catch(err => sendResponse({ error: err.message }));
      return true; // async response

    case 'open-sidepanel':
      if (chrome.sidePanel) {
        chrome.sidePanel.open({ windowId: sender.tab?.windowId });
      }
      sendResponse({ ok: true });
      break;

    case 'open-hub':
      chrome.tabs.create({ url: chrome.runtime.getURL('hub.html'), active: true });
      sendResponse({ ok: true });
      break;

    default:
      sendResponse({ ok: false, error: 'Unknown message type' });
  }
});

/* ══════════════ Cron Alarms ══════════════ */
function setupAutomationAlarm(job) {
  const name = `automation_${job.id}`;
  const minutes = FREQ_MAP[job.freq];
  if (minutes) {
    chrome.alarms.create(name, { periodInMinutes: minutes });
    console.log(`[AMI Browser] Alarm created: ${name} every ${minutes}m`);
  } else {
    chrome.alarms.create(name, { periodInMinutes: 60 });
    console.log(`[AMI Browser] Alarm created: ${name} with custom cron (defaulting to 60m)`);
  }
}

function handleAutomationToggle(idx, enabled) {
  chrome.storage.local.get(STORE.automations, data => {
    const automations = data[STORE.automations] || [];
    if (automations[idx]) {
      const name = `automation_${automations[idx].id}`;
      if (enabled) {
        setupAutomationAlarm(automations[idx]);
      } else {
        chrome.alarms.clear(name);
        console.log(`[AMI Browser] Alarm cleared: ${name}`);
      }
    }
  });
}

function restoreAutomationAlarms() {
  chrome.storage.local.get(STORE.automations, data => {
    const automations = data[STORE.automations] || [];
    automations.forEach(job => {
      if (job.enabled) setupAutomationAlarm(job);
    });
  });
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm.name.startsWith('automation_')) return;
  const jobId = parseInt(alarm.name.replace('automation_', ''), 10);
  console.log(`[AMI Browser] Alarm fired: ${alarm.name}`);

  chrome.storage.local.get([STORE.automations, STORE.paused, STORE.stats, 'ami_config'], async data => {
    if (data[STORE.paused]) return;

    const automations = data[STORE.automations] || [];
    const job = automations.find(item => item.id === jobId);
    if (!job || !job.enabled) return;

    // Pass user's LLM config to cron so the agent can use AI + connections
    const config = data['ami_config'] || null;

    try {
      await fetch(`${GW_HTTP}/api/cron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: job.task, source: 'scheduled-automation', jobId: job.id, name: job.name, config }),
      });

      const stats = data[STORE.stats] || { tasks: 0, pages: 0, automations: 0 };
      stats.tasks += 1;
      stats.automations = automations.length;
      chrome.storage.local.set({ [STORE.stats]: stats });
    } catch (err) {
      console.error(`[AMI Browser] Scheduled automation ${job.name} failed:`, err.message);
    }

    if (job.notify) {
      chrome.notifications.create(`automation_done_${jobId}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `AMI Browser: ${job.name}`,
        message: 'Scheduled automation completed.',
      });
    }
  });
});

/* ══════════════ Screenshot ══════════════ */
async function captureScreenshot() {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, dataUrl => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(dataUrl);
      }
    });
  });
}

async function executeAction(action) {
  if (!action || !action.type) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  switch (action.type) {
    case 'navigate':
      await chrome.tabs.update(tab.id, { url: action.url });
      break;

    case 'click':
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selector) => {
          const el = document.querySelector(selector);
          if (el) el.click();
        },
        args: [action.selector],
      });
      break;

    case 'type':
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selector, text) => {
          const el = document.querySelector(selector);
          if (el) {
            el.focus();
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        },
        args: [action.selector, action.text],
      });
      break;

    case 'scroll':
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (x, y) => window.scrollBy(x, y),
        args: [action.x || 0, action.y || 300],
      });
      break;

    case 'wait':
      // Handled by the caller with setTimeout
      break;

    case 'screenshot':
      return captureScreenshot();

    case 'chat':
      return;
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'ami-browser-automate') return;

  let task = '';
  if (info.selectionText) {
    task = `Process this text: "${info.selectionText}"`;
  } else if (info.linkUrl) {
    task = `Go to ${info.linkUrl} and analyze the page`;
  } else {
    task = `Analyze the current page: ${tab.url}`;
  }

  chrome.storage.local.set({
    [STORE.pendingTask]: task,
  }, () => {
    chrome.tabs.create({ url: 'chrome://newtab' });
  });
});

if (chrome.sidePanel) {
  chrome.sidePanel.setOptions({
    path: 'sidepanel.html',
    enabled: true,
  });
}

/* ══════════════ Cookie Capture ══════════════ */
async function getCookiesForDomain(domain) {
  if (!domain) {
    // Get cookies for the active tab's domain
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return [];
    try {
      const tabUrl = new URL(tab.url);
      domain = tabUrl.hostname;
    } catch { return []; }
  }
  // chrome.cookies.getAll returns cookies matching the domain
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain }, (cookies) => {
      if (chrome.runtime.lastError) {
        console.warn('[AMI Browser] Cookie access error:', chrome.runtime.lastError.message);
        resolve([]);
        return;
      }
      // Return sanitized cookie list (name, value, domain, path, httpOnly, secure, sameSite)
      resolve((cookies || []).map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
        expirationDate: c.expirationDate,
      })));
    });
  });
}

/* ══════════════ Third-party API Call (via agent action) ══════════════ */
async function executeApiCall(payload) {
  if (!payload || !payload.url) return { error: 'url is required' };
  const { url, method, headers, body } = payload;

  // Only allow HTTPS URLs or localhost for security
  if (!url.startsWith('https://') && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
    return { error: 'Only HTTPS or localhost URLs are allowed for API calls' };
  }

  try {
    const opts = {
      method: method || 'GET',
      headers: headers || {},
    };
    if (body && opts.method !== 'GET') {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
      if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    }
    const resp = await fetch(url, opts);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: resp.status, ok: resp.ok, data };
  } catch (err) {
    return { error: err.message };
  }
}

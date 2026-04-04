/* AMI Shield — Background Service Worker
   Tracks blocked requests per tab and globally.
   Uses declarativeNetRequest for efficient, Manifest V3 native blocking. */

const STORAGE_KEY = 'ami_shield_stats';
const DEFAULT_STATS = { totalBlocked: 0, adsBlocked: 0, trackersBlocked: 0, tabStats: {} };

let sessionStats = { ...DEFAULT_STATS };

// ── Load persisted stats ──
chrome.storage.local.get(STORAGE_KEY, (res) => {
  if (res[STORAGE_KEY]) {
    sessionStats = { ...DEFAULT_STATS, ...res[STORAGE_KEY] };
  }
});

// ── Count blocked requests via declarativeNetRequestFeedback ──
if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    const tabId = info.request.tabId;
    if (tabId < 0) return;

    sessionStats.totalBlocked++;

    const rulesetId = info.rule.rulesetId || '';
    if (rulesetId.includes('adblock')) {
      sessionStats.adsBlocked++;
    } else if (rulesetId.includes('tracker')) {
      sessionStats.trackersBlocked++;
    }

    if (!sessionStats.tabStats[tabId]) {
      sessionStats.tabStats[tabId] = { blocked: 0 };
    }
    sessionStats.tabStats[tabId].blocked++;

    // Update badge
    const count = sessionStats.tabStats[tabId].blocked;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#7c3aed', tabId });

    // Persist every 10 blocks
    if (sessionStats.totalBlocked % 10 === 0) {
      persistStats();
    }
  });
}

// ── Fallback: poll matched rules count ──
async function updateMatchedRulesCount() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) return;
    const tabId = tabs[0].id;

    const rules = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
    const count = rules.rulesMatchedInfo ? rules.rulesMatchedInfo.length : 0;

    if (!sessionStats.tabStats[tabId]) {
      sessionStats.tabStats[tabId] = { blocked: 0 };
    }
    if (count > sessionStats.tabStats[tabId].blocked) {
      const diff = count - sessionStats.tabStats[tabId].blocked;
      sessionStats.totalBlocked += diff;
      sessionStats.tabStats[tabId].blocked = count;
    }

    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#7c3aed', tabId });
  } catch (_) {
    // silently ignore
  }
}

// Poll every 3 seconds for stats
setInterval(updateMatchedRulesCount, 3000);

// ── Reset tab stats on navigation ──
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    sessionStats.tabStats[tabId] = { blocked: 0 };
    chrome.action.setBadgeText({ text: '', tabId });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete sessionStats.tabStats[tabId];
});

// ── Toggle shield on/off ──
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_STATS') {
    sendResponse({
      totalBlocked: sessionStats.totalBlocked,
      adsBlocked: sessionStats.adsBlocked,
      trackersBlocked: sessionStats.trackersBlocked,
      tabBlocked: sessionStats.tabStats[msg.tabId]?.blocked || 0
    });
    return true;
  }

  if (msg.type === 'TOGGLE_SHIELD') {
    chrome.declarativeNetRequest.getEnabledRulesets().then((enabled) => {
      const allIds = ['ami_adblock_rules', 'ami_tracker_rules', 'ami_annoyance_rules'];
      if (enabled.length > 0) {
        chrome.declarativeNetRequest.updateEnabledRulesets({
          disableRulesetIds: allIds
        });
        sendResponse({ enabled: false });
      } else {
        chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: allIds
        });
        sendResponse({ enabled: true });
      }
    });
    return true;
  }

  if (msg.type === 'RESET_STATS') {
    sessionStats = { ...DEFAULT_STATS };
    persistStats();
    sendResponse({ ok: true });
    return true;
  }
});

// Allow AMI Hub extension to read Shield status safely.
chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'GET_STATS') {
    sendResponse({
      totalBlocked: sessionStats.totalBlocked,
      adsBlocked: sessionStats.adsBlocked,
      trackersBlocked: sessionStats.trackersBlocked,
      tabBlocked: 0,
    });
    return true;
  }
});

function persistStats() {
  const toSave = {
    totalBlocked: sessionStats.totalBlocked,
    adsBlocked: sessionStats.adsBlocked,
    trackersBlocked: sessionStats.trackersBlocked
  };
  chrome.storage.local.set({ [STORAGE_KEY]: toSave });
}

// Save on suspend
chrome.runtime.onSuspend?.addListener(persistStats);

// Save periodically
setInterval(persistStats, 30000);

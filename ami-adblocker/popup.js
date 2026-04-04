document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('shield-toggle');
  const statusText = document.getElementById('status-text');
  const totalEl = document.getElementById('total-blocked');
  const adsEl = document.getElementById('ads-blocked');
  const trackersEl = document.getElementById('trackers-blocked');
  const pageEl = document.getElementById('page-blocked');
  const resetBtn = document.getElementById('reset-stats');

  function formatNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id || -1;

  // Fetch stats
  chrome.runtime.sendMessage({ type: 'GET_STATS', tabId }, (stats) => {
    if (!stats) return;
    totalEl.textContent = formatNum(stats.totalBlocked);
    adsEl.textContent = formatNum(stats.adsBlocked);
    trackersEl.textContent = formatNum(stats.trackersBlocked);
    pageEl.textContent = formatNum(stats.tabBlocked);
  });

  // Check enabled state
  const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
  const isOn = enabled.length > 0;
  toggle.checked = isOn;
  statusText.textContent = isOn ? 'ON' : 'OFF';

  // Toggle handling
  toggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'TOGGLE_SHIELD' }, (res) => {
      if (res) {
        statusText.textContent = res.enabled ? 'ON' : 'OFF';
      }
    });
  });

  // Reset stats
  resetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'RESET_STATS' }, () => {
      totalEl.textContent = '0';
      adsEl.textContent = '0';
      trackersEl.textContent = '0';
      pageEl.textContent = '0';
    });
  });
});

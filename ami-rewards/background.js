/* AMI Rewards — Background (stub for future rewards logic) */

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    ami_rewards: {
      enrolled: false,
      balance: 0,
      adsViewed: 0,
      status: 'coming_soon'
    }
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_REWARDS_STATUS') {
    chrome.storage.local.get('ami_rewards', (res) => {
      sendResponse(res.ami_rewards || { enrolled: false, balance: 0, adsViewed: 0, status: 'coming_soon' });
    });
    return true;
  }
});

// Allow AMI Hub extension to read rewards status safely.
chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'GET_REWARDS_STATUS') {
    chrome.storage.local.get('ami_rewards', (res) => {
      sendResponse(res.ami_rewards || { enrolled: false, balance: 0, adsViewed: 0, status: 'coming_soon' });
    });
    return true;
  }
});

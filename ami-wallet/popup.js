'use strict';

// Core Wallet extension ID on Chrome Web Store
const CORE_WALLET_CWS_URL = 'https://chromewebstore.google.com/detail/core-crypto-wallet-nft-de/agoakfejjabomempkjlepdflaleeobhb';

// Check if Core Wallet is installed and get its ID
async function findCoreWallet() {
  return new Promise(resolve => {
    chrome.management.getAll(exts => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      const core = exts.find(e =>
        e.name.toLowerCase().includes('core') &&
        (e.description || '').toLowerCase().includes('wallet') &&
        e.enabled
      );
      resolve(core || null);
    });
  });
}

async function init() {
  const core = await findCoreWallet();

  const coreStatus = document.getElementById('core-status');
  const installBtn = document.getElementById('install-core');

  if (core) {
    coreStatus.style.display = 'block';
    installBtn.closest('.card').querySelector('.card-title').textContent = 'Installed';
    installBtn.querySelector('.wallet-desc').textContent = 'Core Wallet is active. Click to open it.';
    installBtn.querySelector('.badge').textContent = 'Installed';
    installBtn.querySelector('.badge').className = 'badge badge-builtin';

    // Open Core Wallet's popup or options page when clicked
    installBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // Try opening Core Wallet's popup by launching its extension page
      const popupUrl = `chrome-extension://${core.id}/popup.html`;
      chrome.tabs.create({ url: core.optionsUrl || popupUrl });
    });
  } else {
    installBtn.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: CORE_WALLET_CWS_URL });
    });
  }
}

init();

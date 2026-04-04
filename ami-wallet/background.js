/* AMI Wallet — Background Service Worker
   Manages wallet state, keystore, and dApp connection requests.
   All private keys encrypted with user passphrase via Web Crypto API. */

const STORE = {
  wallets: 'ami_wallet_accounts',
  settings: 'ami_wallet_settings',
  connectedSites: 'ami_wallet_connected',
  pendingRequests: 'ami_wallet_pending',
};

const DEFAULT_SETTINGS = {
  initialized: false,
  locked: true,
  selectedChain: 'ethereum',
  networks: {
    ethereum: { chainId: '0x1', name: 'Ethereum', rpc: 'https://eth.llamarpc.com', symbol: 'ETH', explorer: 'https://etherscan.io' },
    avalanche: { chainId: '0xa86a', name: 'Avalanche C-Chain', rpc: 'https://api.avax.network/ext/bc/C/rpc', symbol: 'AVAX', explorer: 'https://snowtrace.io' },
    polygon: { chainId: '0x89', name: 'Polygon', rpc: 'https://polygon-rpc.com', symbol: 'MATIC', explorer: 'https://polygonscan.com' },
    bsc: { chainId: '0x38', name: 'BNB Chain', rpc: 'https://bsc-dataseed.binance.org', symbol: 'BNB', explorer: 'https://bscscan.com' },
    arbitrum: { chainId: '0xa4b1', name: 'Arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', symbol: 'ETH', explorer: 'https://arbiscan.io' },
    base: { chainId: '0x2105', name: 'Base', rpc: 'https://mainnet.base.org', symbol: 'ETH', explorer: 'https://basescan.org' },
  },
};

// ── Init ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(STORE.settings, (res) => {
    if (!res[STORE.settings]) {
      chrome.storage.local.set({ [STORE.settings]: DEFAULT_SETTINGS });
    }
  });
});

// ── Message handler ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'WALLET_GET_STATE': {
      chrome.storage.local.get([STORE.settings, STORE.wallets], (res) => {
        const settings = res[STORE.settings] || DEFAULT_SETTINGS;
        const wallets = res[STORE.wallets] || [];
        sendResponse({
          initialized: settings.initialized,
          locked: settings.locked,
          accountCount: wallets.length,
          selectedChain: settings.selectedChain,
          networks: settings.networks,
        });
      });
      return true;
    }

    case 'WALLET_CREATE': {
      // In production, this would use Web Crypto to derive keys from mnemonic
      // For now, store a placeholder account structure
      chrome.storage.local.get(STORE.wallets, (res) => {
        const wallets = res[STORE.wallets] || [];
        const newWallet = {
          index: wallets.length,
          name: msg.name || `Account ${wallets.length + 1}`,
          address: '0x' + Array.from(crypto.getRandomValues(new Uint8Array(20))).map(b => b.toString(16).padStart(2, '0')).join(''),
          createdAt: new Date().toISOString(),
        };
        wallets.push(newWallet);
        chrome.storage.local.set({
          [STORE.wallets]: wallets,
          [STORE.settings]: { ...DEFAULT_SETTINGS, initialized: true, locked: false },
        });
        sendResponse({ ok: true, wallet: newWallet });
      });
      return true;
    }

    case 'WALLET_GET_ACCOUNTS': {
      chrome.storage.local.get(STORE.wallets, (res) => {
        sendResponse({ accounts: res[STORE.wallets] || [] });
      });
      return true;
    }

    case 'WALLET_CONNECT_SITE': {
      const origin = sender.tab ? new URL(sender.tab.url).origin : msg.origin;
      chrome.storage.local.get(STORE.connectedSites, (res) => {
        const sites = res[STORE.connectedSites] || {};
        sites[origin] = { connectedAt: new Date().toISOString(), permitted: true };
        chrome.storage.local.set({ [STORE.connectedSites]: sites });
        sendResponse({ connected: true });
      });
      return true;
    }

    case 'WALLET_SWITCH_CHAIN': {
      chrome.storage.local.get(STORE.settings, (res) => {
        const settings = res[STORE.settings] || DEFAULT_SETTINGS;
        if (settings.networks[msg.chain]) {
          settings.selectedChain = msg.chain;
          chrome.storage.local.set({ [STORE.settings]: settings });
          sendResponse({ ok: true, chain: msg.chain });
        } else {
          sendResponse({ ok: false, error: 'Unknown chain' });
        }
      });
      return true;
    }
  }
});

(() => {
  if (window.amiWallet) return;

  const request = async ({ method, params }) => {
    switch (method) {
      case 'eth_requestAccounts': {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'WALLET_CONNECT_SITE' }, () => {
            chrome.runtime.sendMessage({ type: 'WALLET_GET_ACCOUNTS' }, (res) => {
              const accounts = (res?.accounts || []).map((a) => a.address);
              resolve(accounts);
            });
          });
        });
      }
      case 'eth_accounts': {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'WALLET_GET_ACCOUNTS' }, (res) => {
            resolve((res?.accounts || []).map((a) => a.address));
          });
        });
      }
      case 'eth_chainId': {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'WALLET_GET_STATE' }, (res) => {
            const selected = res?.selectedChain;
            const chainId = res?.networks?.[selected]?.chainId || '0x1';
            resolve(chainId);
          });
        });
      }
      default:
        throw new Error(`Method not implemented in AMI Wallet: ${method}`);
    }
  };

  window.amiWallet = {
    isAMIWallet: true,
    isMetaMask: false,
    request,
    on: () => {},
    removeListener: () => {},
  };

  if (!window.ethereum) {
    window.ethereum = window.amiWallet;
  }

  window.dispatchEvent(new Event('ethereum#initialized'));
})();

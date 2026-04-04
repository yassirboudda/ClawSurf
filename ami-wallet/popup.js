async function call(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => resolve(res));
  });
}

function shortAddr(a = '') {
  if (!a || a.length < 12) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

async function render() {
  const state = await call('WALLET_GET_STATE');
  const accountsRes = await call('WALLET_GET_ACCOUNTS');
  const accounts = accountsRes?.accounts || [];

  const status = document.getElementById('wallet-status');
  const dot = document.getElementById('wallet-dot');
  const count = document.getElementById('account-count');
  const chain = document.getElementById('chain-select');
  const list = document.getElementById('accounts-list');

  status.lastChild.textContent = state?.locked ? ' Locked' : ' Ready';
  dot.classList.toggle('on', !state?.locked);
  count.textContent = String(accounts.length);

  chain.innerHTML = '';
  const networks = state?.networks || {};
  for (const [key, cfg] of Object.entries(networks)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${cfg.name} (${cfg.symbol})`;
    if (key === state?.selectedChain) opt.selected = true;
    chain.appendChild(opt);
  }

  list.innerHTML = '';
  if (!accounts.length) {
    list.innerHTML = '<div class="acct">No accounts yet. Click <strong>Create Wallet</strong>.</div>';
  } else {
    for (const a of accounts) {
      const div = document.createElement('div');
      div.className = 'acct';
      div.innerHTML = `<strong>${a.name}</strong><code>${shortAddr(a.address)}</code>`;
      list.appendChild(div);
    }
  }
}

document.getElementById('btn-create').addEventListener('click', async () => {
  await call('WALLET_CREATE', { name: 'Main Account' });
  await render();
});

document.getElementById('btn-refresh').addEventListener('click', render);

document.getElementById('chain-select').addEventListener('change', async (e) => {
  await call('WALLET_SWITCH_CHAIN', { chain: e.target.value });
  await render();
});

render();

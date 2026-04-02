/**
 * CDP automation — attach Electron's debugger to webContents for browser control.
 */

const attached = new Map(); // wcId → true

async function attachDebugger(wc) {
  if (attached.has(wc.id)) return;
  try {
    wc.debugger.attach('1.3');
    attached.set(wc.id, true);

    wc.debugger.on('detach', () => {
      attached.delete(wc.id);
    });

    // Enable useful CDP domains
    await wc.debugger.sendCommand('Network.enable');
    await wc.debugger.sendCommand('Runtime.enable');
    await wc.debugger.sendCommand('Page.enable');
    await wc.debugger.sendCommand('DOM.enable');

    console.log(`[automation] Debugger attached to webContents ${wc.id}`);
  } catch (err) {
    console.warn(`[automation] Could not attach debugger: ${err.message}`);
    throw err;
  }
}

async function executeCommand(wc, method, params = {}) {
  if (!attached.has(wc.id)) {
    await attachDebugger(wc);
  }
  return wc.debugger.sendCommand(method, params);
}

function detachAll() {
  for (const [wcId] of attached) {
    try {
      const { webContents } = require('electron');
      const wc = webContents.fromId(wcId);
      if (wc) wc.debugger.detach();
    } catch {}
  }
  attached.clear();
  console.log('[automation] All debuggers detached.');
}

module.exports = { attachDebugger, executeCommand, detachAll };

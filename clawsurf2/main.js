const { app, BrowserWindow, ipcMain, session, webContents } = require('electron');
const path = require('path');
const { startGateway, stopGateway } = require('./lib/gateway');
const { setupFirewall, teardownFirewall, killAllChildren } = require('./lib/security');
const { attachDebugger, executeCommand, detachAll } = require('./lib/automation');

let mainWindow = null;
const childPids = new Set();

/* ── Enforce single instance ── */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

/* ── App lifecycle ── */
app.on('ready', async () => {
  setupFirewall();

  // Start built-in OpenClaw gateway
  const gwPid = startGateway();
  if (gwPid) childPids.add(gwPid);

  // Load existing ClawSurf extensions into the browser session
  const browserSession = session.fromPartition('persist:clawsurf2');
  const extDirs = [
    path.join(__dirname, '..', 'extension'),
    path.join(__dirname, '..', 'teachanagent'),
    path.join(__dirname, '..', 'devtools-mcp'),
  ];
  for (const dir of extDirs) {
    try {
      await browserSession.loadExtension(dir, { allowFileAccess: true });
    } catch (e) {
      console.warn(`[ext] Could not load ${dir}: ${e.message}`);
    }
  }

  createMainWindow();
  registerIPC();
});

app.on('before-quit', () => {
  cleanup();
});

app.on('window-all-closed', () => {
  cleanup();
  app.quit();
});

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('uncaughtException', (err) => {
  console.error('[fatal]', err);
  // Only crash on truly fatal errors, not port conflicts
  if (err.code === 'EADDRINUSE') {
    console.warn('[warning] A port is already in use — continuing with reduced functionality');
    return;
  }
  cleanup();
  process.exit(1);
});

/* ── Window ── */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a12',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      partition: 'persist:clawsurf2-ui',
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ── IPC handlers ── */
function registerIPC() {
  // Window controls
  ipcMain.on('win:minimize', () => mainWindow?.minimize());
  ipcMain.on('win:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('win:close', () => {
    cleanup();
    mainWindow?.close();
  });

  // Get webContents ID for a webview (renderer sends tag's getWebContentsId)
  ipcMain.handle('browser:attach-debugger', async (_e, wcId) => {
    try {
      const wc = webContents.fromId(wcId);
      if (!wc) return { ok: false, error: 'WebContents not found' };
      await attachDebugger(wc);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('browser:execute', async (_e, wcId, method, params) => {
    try {
      const wc = webContents.fromId(wcId);
      if (!wc) return { ok: false, error: 'WebContents not found' };
      const result = await executeCommand(wc, method, params);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Automation: high-level actions from chat
  ipcMain.handle('automation:navigate', async (_e, wcId, url) => {
    try {
      const wc = webContents.fromId(wcId);
      if (!wc) return { ok: false, error: 'WebContents not found' };
      await wc.loadURL(url.startsWith('http') ? url : `https://${url}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('automation:click', async (_e, wcId, selector) => {
    try {
      const wc = webContents.fromId(wcId);
      if (!wc) return { ok: false, error: 'WebContents not found' };
      await wc.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.click()`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('automation:type', async (_e, wcId, selector, text) => {
    try {
      const wc = webContents.fromId(wcId);
      if (!wc) return { ok: false, error: 'WebContents not found' };
      await wc.executeJavaScript(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.focus();
          el.value = ${JSON.stringify(text)};
          el.dispatchEvent(new Event('input', {bubbles:true}));
          el.dispatchEvent(new Event('change', {bubbles:true}));
          return true;
        })()
      `);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('automation:screenshot', async (_e, wcId) => {
    try {
      const wc = webContents.fromId(wcId);
      if (!wc) return { ok: false, error: 'WebContents not found' };
      const img = await wc.capturePage();
      return { ok: true, dataUrl: img.toDataURL() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('automation:get-html', async (_e, wcId, selector) => {
    try {
      const wc = webContents.fromId(wcId);
      if (!wc) return { ok: false, error: 'WebContents not found' };
      const html = await wc.executeJavaScript(
        selector
          ? `document.querySelector(${JSON.stringify(selector)})?.outerHTML || ''`
          : `document.documentElement.outerHTML`
      );
      return { ok: true, html };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Gateway status
  ipcMain.handle('gateway:status', () => {
    return { running: true, ports: { gateway: 18789, relay: 18792, cdp: 18800, mcp: 9223 } };
  });
}

/* ── Cleanup ── */
function cleanup() {
  console.log('[cleanup] Shutting down ClawSurf 2.0...');
  detachAll();
  stopGateway();
  killAllChildren(childPids);
  teardownFirewall();
  console.log('[cleanup] Done.');
}

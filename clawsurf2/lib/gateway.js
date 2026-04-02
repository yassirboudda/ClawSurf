const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');

let httpServer = null;
let wsServer = null;
let mcpProcess = null;

const connectedClients = new Set();

/**
 * Start the built-in OpenClaw gateway.
 * - HTTP health-check on 127.0.0.1:18789
 * - WebSocket relay on 127.0.0.1:18792
 * - Also starts the MCP server as a child process
 */
function startGateway() {
  // ── HTTP health endpoint (replaces external OpenClaw gateway) ──
  httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/' || req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        app: 'ClawSurf 2.0',
        version: '2.0.0',
        uptime: process.uptime(),
        clients: connectedClients.size,
      }));
      return;
    }

    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        gateway: true,
        relay: wsServer !== null,
        mcp: mcpProcess !== null && mcpProcess.exitCode === null,
        clients: connectedClients.size,
      }));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn('[gateway] Port 18789 already in use — health endpoint skipped');
    } else {
      console.error('[gateway] HTTP error:', err);
    }
  });
  httpServer.listen(18789, '127.0.0.1', () => {
    console.log('[gateway] Health endpoint on http://127.0.0.1:18789');
  });

  // ── WebSocket relay ──
  try {
    wsServer = new WebSocketServer({ port: 18792, host: '127.0.0.1' });
    wsServer.on('listening', () => {
      console.log('[gateway] WebSocket relay on ws://127.0.0.1:18792');
    });
    wsServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn('[gateway] Port 18792 already in use — relay skipped');
      } else {
        console.error('[gateway] WS server error:', err);
      }
    });

  wsServer.on('connection', (ws) => {
    connectedClients.add(ws);
    console.log(`[gateway] Client connected (total: ${connectedClients.size})`);

    ws.on('message', (data) => {
      // Broadcast to all other clients (relay behavior)
      for (const client of connectedClients) {
        if (client !== ws && client.readyState === 1) {
          client.send(data);
        }
      }
    });

    ws.on('close', () => {
      connectedClients.delete(ws);
      console.log(`[gateway] Client disconnected (total: ${connectedClients.size})`);
    });

    ws.on('error', (err) => {
      console.warn('[gateway] WS error:', err.message);
      connectedClients.delete(ws);
    });
  });
  } catch (err) {
    console.warn('[gateway] Could not start WebSocket relay:', err.message);
  }

  // ── Start DevTools MCP server ──
  const mcpServerPath = path.join(__dirname, '..', '..', 'devtools-mcp-server', 'server.js');
  try {
    mcpProcess = spawn('node', [mcpServerPath], {
      stdio: 'pipe',
      env: { ...process.env },
    });
    mcpProcess.stdout?.on('data', (d) => console.log('[mcp]', d.toString().trim()));
    mcpProcess.stderr?.on('data', (d) => console.warn('[mcp:err]', d.toString().trim()));
    mcpProcess.on('exit', (code) => {
      console.log(`[mcp] Exited with code ${code}`);
      mcpProcess = null;
    });
    console.log(`[gateway] MCP server started (PID ${mcpProcess.pid})`);
    return mcpProcess.pid;
  } catch (err) {
    console.warn('[gateway] Could not start MCP server:', err.message);
    return null;
  }
}

function stopGateway() {
  console.log('[gateway] Stopping...');

  for (const ws of connectedClients) {
    try { ws.close(); } catch {}
  }
  connectedClients.clear();

  if (wsServer) {
    try { wsServer.close(); } catch {}
    wsServer = null;
  }

  if (httpServer) {
    try { httpServer.close(); } catch {}
    httpServer = null;
  }

  if (mcpProcess && mcpProcess.exitCode === null) {
    console.log(`[gateway] Killing MCP server (PID ${mcpProcess.pid})`);
    try { mcpProcess.kill('SIGTERM'); } catch {}
    // Force kill after 2s
    setTimeout(() => {
      if (mcpProcess && mcpProcess.exitCode === null) {
        try { mcpProcess.kill('SIGKILL'); } catch {}
      }
    }, 2000);
  }
}

module.exports = { startGateway, stopGateway };

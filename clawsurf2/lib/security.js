const { execSync } = require('child_process');

const MANAGED_PORTS = [18789, 18792, 18800, 9223];
const IPTABLES_COMMENT = 'clawsurf2-guard';
let firewallActive = false;

/**
 * Set up iptables rules to block external access to ClawSurf ports.
 * All services bind to 127.0.0.1, these rules are an extra safety layer.
 */
function setupFirewall() {
  try {
    for (const port of MANAGED_PORTS) {
      // Drop any incoming packets to our ports from non-loopback interfaces
      execSync(
        `sudo -n iptables -C INPUT -p tcp --dport ${port} ! -i lo -j DROP -m comment --comment "${IPTABLES_COMMENT}" 2>/dev/null || ` +
        `sudo -n iptables -A INPUT -p tcp --dport ${port} ! -i lo -j DROP -m comment --comment "${IPTABLES_COMMENT}"`,
        { stdio: 'pipe' }
      );
    }
    firewallActive = true;
    console.log('[security] Firewall rules active — external access blocked on ports:', MANAGED_PORTS.join(', '));
  } catch {
    console.warn('[security] Could not set iptables rules (no sudo?). Services still bind to 127.0.0.1 only.');
    firewallActive = false;
  }
}

/**
 * Remove the iptables rules we added.
 */
function teardownFirewall() {
  if (!firewallActive) return;
  try {
    for (const port of MANAGED_PORTS) {
      execSync(
        `sudo -n iptables -D INPUT -p tcp --dport ${port} ! -i lo -j DROP -m comment --comment "${IPTABLES_COMMENT}" 2>/dev/null || true`,
        { stdio: 'pipe' }
      );
    }
    console.log('[security] Firewall rules removed.');
  } catch {
    console.warn('[security] Could not remove iptables rules.');
  }
  firewallActive = false;
}

/**
 * Kill all tracked child processes and any stray processes on our ports.
 */
function killAllChildren(pidSet) {
  // Kill tracked PIDs
  for (const pid of pidSet) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[security] Killed child PID ${pid}`);
    } catch {}
  }
  pidSet.clear();

  // Kill anything still listening on our ports (safety net)
  for (const port of MANAGED_PORTS) {
    try {
      const output = execSync(`lsof -ti :${port} 2>/dev/null || true`, { encoding: 'utf8' }).trim();
      if (output) {
        const pids = output.split('\n').filter(Boolean);
        for (const pid of pids) {
          if (parseInt(pid) !== process.pid && parseInt(pid) !== process.ppid) {
            try {
              process.kill(parseInt(pid), 'SIGTERM');
              console.log(`[security] Killed stray process ${pid} on port ${port}`);
            } catch {}
          }
        }
      }
    } catch {}
  }
}

module.exports = { setupFirewall, teardownFirewall, killAllChildren };

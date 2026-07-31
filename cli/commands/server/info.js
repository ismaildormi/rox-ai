// ROX AI — cli/commands/server/info.js
//
// One-screen machine/process overview: OS-level facts from Node's
// built-in `os` module (no new dependency), plus the same pm2 `jlist`
// `rox health` already parses, for rox-api/rox-worker specifically —
// not a general "everything about this VM" dump, since disk detail
// already has `rox monitor`, AI has `rox ai status`, and queues have
// `rox queue status`; this is a pointer to all of those plus what's
// genuinely only available here (uptime, load average, node version).

const os = require('os');
const { log, capture, pm2Available, PM2_BIN } = require('../../lib/util');

function fmtBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

module.exports = async function info() {
  log.step('ROX AI — server info');

  log.step('Machine');
  console.log(`  hostname: ${os.hostname()}`);
  console.log(`  platform: ${os.platform()} ${os.arch()} (${os.release()})`);
  console.log(`  node: ${process.version}`);
  console.log(`  uptime: ${fmtUptime(os.uptime())}`);
  const load = os.loadavg();
  console.log(`  load average (1m/5m/15m): ${load.map((n) => n.toFixed(2)).join(' / ')}`);
  console.log(`  cpus: ${os.cpus().length}x ${os.cpus()[0]?.model || 'unknown'}`);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  console.log(`  memory: ${fmtBytes(totalMem - freeMem)} used / ${fmtBytes(totalMem)} total (${(((totalMem - freeMem) / totalMem) * 100).toFixed(1)}%)`);

  console.log('');
  log.step('rox-api / rox-worker (pm2)');
  if (!pm2Available()) {
    log.warn('pm2 is not installed — run `rox setup`.');
  } else {
    try {
      const list = JSON.parse(capture(PM2_BIN, ['jlist']));
      for (const name of ['rox-api', 'rox-worker']) {
        const proc = list.find((p) => p.name === name);
        if (!proc) {
          log.err(`${name}: not registered with pm2`);
          continue;
        }
        const env = proc.pm2_env || {};
        const mem = proc.monit ? fmtBytes(proc.monit.memory) : 'unknown';
        const cpu = proc.monit ? `${proc.monit.cpu}%` : 'unknown';
        const line = `${name}: ${env.status} — up ${env.pm_uptime ? fmtUptime((Date.now() - env.pm_uptime) / 1000) : 'unknown'}, restarts: ${env.restart_time}, mem: ${mem}, cpu: ${cpu}`;
        if (env.status === 'online') log.ok(line);
        else log.err(line);
      }
    } catch (err) {
      log.err(`Could not read pm2 process list: ${err.message}`);
    }
  }

  console.log('');
  log.info('Disk detail: `rox monitor`. AI subsystem: `rox ai status`. Queues: `rox queue status`.');
};

// ROX AI — cli/commands/optimize.js
//
// Default (`rox optimize`): runs every non-destructive-to-user-data
// action once (temp/cache/old logs/compress logs/docker images —
// exactly maintenance.js's runSafeSweep, same function the scheduled
// /internal/disk/run-scan calls when auto-fix is on) and reports bytes
// freed. Never touches Ollama models, uploads, generated content, or
// Docker volumes — those only ever move via a confirmation:
//
//   rox optimize --list-confirmations
//   rox optimize --confirm <id>
//   rox optimize --reject <id>
//
// Everything else the dashboard's maintenance panel can do also has a
// CLI path, so none of this requires opening it:
//
//   rox optimize --run <actionType> [--description="..."]   run ONE named
//     safe action instead of the whole sweep (e.g. delete_temp,
//     delete_old_logs, docker_prune_images) — same runAction() the sweep
//     calls per-step. Still refuses anything in maintenance.js's
//     NEVER_AUTO set when triggered as 'auto'; from the CLI you're always
//     an explicit admin trigger, same as clicking a single action button
//     on the dashboard.
//   rox optimize --log [--limit=N]   raw maintenance action history
//     (disk_maintenance_log) — every action ever run, not just this
//     session's sweep output.
//   rox optimize --request-confirmation --action=<type> --target='<json>'
//     [--bytes=N] --reason="..."   opens a confirmation request for
//     something that touches real data (an Ollama model, uploads,
//     generated content) — the same request the dashboard's "Request"
//     button creates. Resolve it the normal way afterwards:
//     rox optimize --list-confirmations / --confirm <id> / --reject <id>

const os = require('os');
const path = require('path');
const { BACKEND_DIR, log, loadEnv } = require('../lib/util');

function loadModules() {
  return {
    diskMonitor: require(path.join(BACKEND_DIR, 'src', 'modules', 'diskMonitor')),
    maintenance: require(path.join(BACKEND_DIR, 'src', 'modules', 'diskMonitor', 'maintenance')),
  };
}

function actorId() {
  return `admin:cli:${os.userInfo().username}`;
}

function flagValue(args, name) {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

async function listConfirmations(maintenance, fmtBytes) {
  const pending = await maintenance.listPendingConfirmations();
  if (pending.length === 0) {
    log.info('No pending confirmations.');
    return;
  }
  log.step('Pending confirmations (require an explicit decision):');
  for (const p of pending) {
    console.log(`   [${p.id}] ${p.action_type} — ${JSON.stringify(p.target)} (~${fmtBytes(p.estimated_bytes)}) — requested by ${p.requested_by}`);
  }
  log.info('\nResolve with: rox optimize --confirm <id>   or   rox optimize --reject <id>');
}

module.exports = async function optimize(args) {
  log.step('ROX AI — optimize');
  loadEnv();
  const { diskMonitor, maintenance } = loadModules();

  const confirmId = flagValue(args, '--confirm');
  const rejectId = flagValue(args, '--reject');

  if (args.includes('--list-confirmations')) {
    return listConfirmations(maintenance, diskMonitor.fmtBytes);
  }

  if (confirmId) {
    const result = await maintenance.resolveConfirmation(confirmId, 'confirmed', 'cli');
    log.ok(`Confirmed. ${result.bytes_freed ? `Freed ${diskMonitor.fmtBytes(result.bytes_freed)}.` : ''}`);
    return;
  }

  if (rejectId) {
    await maintenance.resolveConfirmation(rejectId, 'rejected', 'cli');
    log.ok('Rejected — no changes made.');
    return;
  }

  if (args.includes('--log')) {
    const limitArg = flagValue(args, '--limit');
    const entries = await maintenance.listMaintenanceLog({ limit: limitArg ? Number(limitArg) : 50 });
    if (entries.length === 0) {
      log.info('No maintenance actions logged yet.');
      return;
    }
    log.step(`Maintenance log (last ${entries.length}):`);
    for (const e of entries) {
      const bytes = e.bytes_freed ? ` — freed ${diskMonitor.fmtBytes(e.bytes_freed)}` : '';
      const failed = e.status === 'failed' ? ` [FAILED: ${e.error_message}]` : '';
      console.log(`   [${e.id}] ${e.created_at} — ${e.action_type} (${e.triggered_by})${bytes}${failed}`);
    }
    return;
  }

  const runType = flagValue(args, '--run');
  if (runType) {
    const description = flagValue(args, '--description');
    try {
      const result = await maintenance.runAction(runType, actorId(), description);
      log.ok(`${runType}: ${result.status === 'completed' ? `freed ${diskMonitor.fmtBytes(result.bytes_freed || 0)}` : `failed — ${result.error_message}`}`);
    } catch (err) {
      log.err(`${runType} failed: ${err.message}`);
      if (err.code === 'requires_manual_approval') {
        log.info('This action needs a confirmation instead: rox optimize --request-confirmation --action=' + runType + ' --target=\'{"...":"..."}\'');
      } else if (err.code === 'unknown_action') {
        log.info(`Known actions: ${Object.keys(maintenance.ACTIONS).join(', ')}`);
      }
      process.exitCode = 1;
    }
    return;
  }

  if (args.includes('--request-confirmation')) {
    const actionType = flagValue(args, '--action');
    const targetRaw = flagValue(args, '--target');
    const bytesArg = flagValue(args, '--bytes');
    const reason = flagValue(args, '--reason');
    if (!actionType || !targetRaw) {
      log.err('Usage: rox optimize --request-confirmation --action=<type> --target=\'<json>\' [--bytes=N] --reason="..."');
      process.exitCode = 1;
      return;
    }
    let target;
    try {
      target = JSON.parse(targetRaw);
    } catch (err) {
      log.err(`--target must be valid JSON: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    const created = await maintenance.requestConfirmation({
      actionType, target, estimatedBytes: bytesArg ? Number(bytesArg) : 0, reason, requestedBy: actorId(),
    });
    log.ok(`Confirmation requested: [${created.id}]`);
    log.info('Resolve it with: rox optimize --confirm ' + created.id + '   or   --reject ' + created.id);
    return;
  }

  log.info('Running safe maintenance sweep (temp, cache, old logs, log compression, unused Docker images)…');
  const results = await maintenance.runSafeSweep('admin:cli');
  let totalFreed = 0;
  for (const r of results) {
    const bytes = r.bytes_freed || 0;
    totalFreed += bytes;
    const label = r.action_type || r.actionType;
    if (r.status === 'failed') log.err(`${label}: failed — ${r.error_message}`);
    else log.ok(`${label}: freed ${diskMonitor.fmtBytes(bytes)}`);
  }
  log.step(`Total freed: ${diskMonitor.fmtBytes(totalFreed)}`);

  const report = await diskMonitor.getFullReport();
  const needsConfirmation = report.recommendations.filter((r) => r.requiresConfirmation);
  if (needsConfirmation.length > 0) {
    console.log('');
    log.warn('Some potential savings need confirmation before they can be applied:');
    for (const rec of needsConfirmation) console.log(`   - ${rec.message}`);
    log.info('Request one with `rox optimize --request-confirmation ...`, then: rox optimize --list-confirmations');
  }
};


// ROX AI — cli/commands/queue/clear.js
//
// Removes jobs in a given state from a given queue via BullMQ's own
// `Queue.clean()` — a destructive action, so it requires --yes like
// `rox restore` does. Defaults to clearing only `failed` jobs (the
// safe, common case); clearing `completed`/`waiting`/`active` needs an
// explicit --status because those are much easier to regret.
//
// Usage: rox queue clear [--queue=image|video] [--status=failed] --yes

const { log, loadEnv } = require('../../lib/util');
const { tryLoad } = require('../../lib/backendLoader');

const QUEUE_MAP = { image: 'imageQueue', video: 'videoQueue' };
const ALLOWED_STATUSES = ['completed', 'failed', 'active', 'wait', 'delayed', 'paused'];

module.exports = async function clear(args = []) {
  log.step('ROX AI — queue clear');
  loadEnv();

  const queueArg = args.find((a) => a.startsWith('--queue='));
  const statusArg = args.find((a) => a.startsWith('--status='));
  const status = statusArg ? statusArg.split('=')[1] : 'failed';
  const confirmed = args.includes('--yes');
  const queueKeys = queueArg ? [queueArg.split('=')[1]] : Object.keys(QUEUE_MAP);

  if (!ALLOWED_STATUSES.includes(status)) {
    log.err(`Invalid --status "${status}" — must be one of: ${ALLOWED_STATUSES.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  for (const key of queueKeys) {
    if (!QUEUE_MAP[key]) {
      log.err(`Invalid --queue "${key}" — must be "image" or "video".`);
      process.exitCode = 1;
      return;
    }
  }

  if (!confirmed) {
    log.err(`This will permanently remove ${status} jobs from ${queueKeys.join(', ')}. Re-run with --yes to confirm.`);
    process.exitCode = 1;
    return;
  }

  const queueResult = tryLoad('lib/queue');
  if (!queueResult.ok) {
    log.err(`Could not load lib/queue.js: ${queueResult.error.message}`);
    process.exitCode = 1;
    return;
  }

  for (const key of queueKeys) {
    const queue = queueResult.module[QUEUE_MAP[key]];
    try {
      const removedIds = await queue.clean(0, 10000, status);
      log.ok(`${queue.name}: removed ${removedIds.length} ${status} job(s).`);
    } catch (err) {
      log.err(`${queue.name}: clean failed — ${err.message}`);
      process.exitCode = 1;
    }
  }
};

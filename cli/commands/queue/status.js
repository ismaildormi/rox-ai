// ROX AI — cli/commands/queue/status.js
//
// Reads BullMQ's own job-count API (`Queue.getJobCounts()`) for both
// queues defined in backend/lib/queue.js — no separate bookkeeping,
// so this can't drift from what worker.js is actually processing.

const { log, loadEnv } = require('../../lib/util');
const { tryLoad } = require('../../lib/backendLoader');

const QUEUE_NAMES = ['imageQueue', 'videoQueue'];

module.exports = async function status() {
  log.step('ROX AI — queue status');
  loadEnv();

  const queueResult = tryLoad('lib/queue');
  if (!queueResult.ok) {
    log.err(`Could not load lib/queue.js: ${queueResult.error.message}`);
    log.info('Needs `npm install` in backend/ (bullmq, ioredis) and REDIS_URL reachable.');
    process.exitCode = 1;
    return;
  }

  let anyBacklog = false;
  for (const name of QUEUE_NAMES) {
    const queue = queueResult.module[name];
    if (!queue) continue;
    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
      const isPaused = await queue.isPaused();
      log.step(`${queue.name}${isPaused ? ' (PAUSED)' : ''}`);
      for (const [state, count] of Object.entries(counts)) {
        console.log(`  ${state}: ${count}`);
      }
      if (counts.failed > 0) anyBacklog = true;
    } catch (err) {
      log.err(`${name}: could not read job counts — ${err.message}`);
      log.info('Is Redis reachable at REDIS_URL?');
      process.exitCode = 1;
    }
  }

  console.log('');
  if (anyBacklog) {
    log.warn('One or more queues have failed jobs. `rox jobs --status=failed` for detail, `rox queue clear --status=failed` to drop them.');
  } else {
    log.ok('No failed jobs in either queue.');
  }
};

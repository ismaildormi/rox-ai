// ROX AI — cli/commands/queue/restart.js
//
// There's no separate "queue service" to restart — BullMQ queues are
// just Redis-backed job lists that worker.js's Worker instances poll.
// What this actually does, and all it can honestly do without
// restarting worker.js itself (that's `rox restart`): pause each queue
// (stop handing out new jobs to workers) then immediately resume it.
// This is the real BullMQ operation that clears a queue's paused flag
// if one got stuck, and gives currently-active jobs a moment to settle
// before new ones are dispatched again — genuinely useful after e.g. a
// Redis blip, but it is NOT the same as restarting worker.js's process.

const { log, loadEnv } = require('../../lib/util');
const { tryLoad } = require('../../lib/backendLoader');

module.exports = async function restart() {
  log.step('ROX AI — queue restart (pause + resume)');
  loadEnv();

  const queueResult = tryLoad('lib/queue');
  if (!queueResult.ok) {
    log.err(`Could not load lib/queue.js: ${queueResult.error.message}`);
    process.exitCode = 1;
    return;
  }

  for (const name of ['imageQueue', 'videoQueue']) {
    const queue = queueResult.module[name];
    try {
      await queue.pause();
      await queue.resume();
      log.ok(`${queue.name}: paused and resumed.`);
    } catch (err) {
      log.err(`${queue.name}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  console.log('');
  log.info('This only touches queue dispatch state, not the worker process. If rox-worker itself is unresponsive, use `rox restart`.');
};

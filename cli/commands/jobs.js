// ROX AI — cli/commands/jobs.js
//
// Lists individual jobs (not just counts — that's `rox queue status`)
// via BullMQ's `Queue.getJobs()`. Useful for finding *which* job
// failed and why (`job.failedReason`), not just that N jobs failed.
//
// Usage: rox jobs [--queue=image|video] [--status=failed] [--limit=20]

const { log, loadEnv } = require('../lib/util');
const { tryLoad } = require('../lib/backendLoader');

const QUEUE_MAP = { image: 'imageQueue', video: 'videoQueue' };
const DEFAULT_STATUS = 'failed';

module.exports = async function jobs(args = []) {
  log.step('ROX AI — jobs');
  loadEnv();

  const queueArg = args.find((a) => a.startsWith('--queue='));
  const statusArg = args.find((a) => a.startsWith('--status='));
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const status = statusArg ? statusArg.split('=')[1] : DEFAULT_STATUS;
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 20;
  const queueKeys = queueArg ? [queueArg.split('=')[1]] : Object.keys(QUEUE_MAP);

  for (const key of queueKeys) {
    if (!QUEUE_MAP[key]) {
      log.err(`Invalid --queue "${key}" — must be "image" or "video".`);
      process.exitCode = 1;
      return;
    }
  }

  const queueResult = tryLoad('lib/queue');
  if (!queueResult.ok) {
    log.err(`Could not load lib/queue.js: ${queueResult.error.message}`);
    process.exitCode = 1;
    return;
  }

  let total = 0;
  for (const key of queueKeys) {
    const queue = queueResult.module[QUEUE_MAP[key]];
    try {
      const jobList = await queue.getJobs([status], 0, limit - 1);
      log.step(`${queue.name} — ${status} (showing up to ${limit})`);
      if (jobList.length === 0) {
        log.info('none');
        continue;
      }
      for (const job of jobList) {
        total += 1;
        const when = job.finishedOn ? new Date(job.finishedOn).toISOString() : job.processedOn ? new Date(job.processedOn).toISOString() : new Date(job.timestamp).toISOString();
        console.log(`  [${job.id}] ${when} — attempt ${job.attemptsMade}/${job.opts.attempts || 1}`);
        if (job.failedReason) console.log(`    reason: ${job.failedReason.split('\n')[0]}`);
      }
    } catch (err) {
      log.err(`${queue.name}: could not list jobs — ${err.message}`);
      process.exitCode = 1;
    }
  }

  console.log('');
  log.info(`${total} job(s) shown. \`rox queue clear --status=${status} --yes\` to remove them.`);
};

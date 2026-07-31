// ROX AI — cli/commands/cron/status.js
//
// There is no in-process scheduler in this app — /internal/advisor/
// run-daily, /internal/disk/run-scan, /internal/maintenance/run are
// endpoints an EXTERNAL scheduler (cron, GitHub Actions, Railway cron)
// hits once a day with a shared secret. So "status" here can't ask a
// scheduler process how it's doing — instead it checks the two things
// that actually indicate whether the external scheduler is working:
// (1) is CRON_SECRET even configured, so a call could succeed at all,
// and (2) how recently each job's own persisted output was written.
// A report/snapshot that's more than ~36h stale is the honest signal
// something upstream (the scheduler itself, not this app) has stopped
// calling in.

const { log, loadEnv } = require('../../lib/util');
const { tryLoad } = require('../../lib/backendLoader');

const STALE_AFTER_HOURS = 36;

function hoursAgo(iso) {
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

module.exports = async function status() {
  log.step('ROX AI — cron status');
  loadEnv();

  if (!process.env.CRON_SECRET) {
    log.err('CRON_SECRET is not set in backend/.env — the /internal/* endpoints will refuse every call, configured scheduler or not.');
    process.exitCode = 1;
    return;
  }
  log.ok('CRON_SECRET is set.');

  let anyStale = false;

  const advisorResult = tryLoad('src/modules/advisor');
  if (advisorResult.ok) {
    try {
      const report = await advisorResult.module.getLatestReport();
      if (!report) {
        anyStale = true;
        log.warn('advisor/run-daily: no report has ever been persisted.');
      } else {
        const age = hoursAgo(report.created_at);
        const line = `advisor/run-daily: last report ${report.report_date} (${age.toFixed(1)}h ago)`;
        if (age > STALE_AFTER_HOURS) { anyStale = true; log.err(`${line} — stale`); } else log.ok(line);
      }
    } catch (err) {
      log.warn(`advisor/run-daily: could not check (${err.message})`);
    }
  } else {
    log.warn(`advisor/run-daily: could not load advisor module (${advisorResult.error.message})`);
  }

  const diskResult = tryLoad('src/modules/diskMonitor');
  if (diskResult.ok) {
    try {
      const snapshot = await diskResult.module.getLatestSnapshot();
      if (!snapshot) {
        anyStale = true;
        log.warn('disk/run-scan: no snapshot has ever been persisted.');
      } else {
        const age = hoursAgo(snapshot.captured_at);
        const line = `disk/run-scan: last snapshot ${snapshot.captured_at} (${age.toFixed(1)}h ago)`;
        if (age > STALE_AFTER_HOURS) { anyStale = true; log.err(`${line} — stale`); } else log.ok(line);
      }
    } catch (err) {
      log.warn(`disk/run-scan: could not check (${err.message})`);
    }
  } else {
    log.warn(`disk/run-scan: could not load diskMonitor module (${diskResult.error.message})`);
  }

  log.info('maintenance/run: no persisted timestamp for this job (it only writes audit rows when it finds a mismatch) — check your scheduler\'s own call logs for it.');

  console.log('');
  if (anyStale) {
    log.warn('One or more scheduled jobs look stale or have never run. Check that your external scheduler is actually configured and hitting these endpoints, or run `rox cron restart` to trigger all three manually right now.');
    process.exitCode = 1;
  } else {
    log.ok('Scheduled jobs look current.');
  }
};

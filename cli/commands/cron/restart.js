// ROX AI — cli/commands/cron/restart.js
//
// Named to match the requested command, but honestly there's nothing
// running in-process to "restart" — see status.js's header comment.
// What this does instead, and says clearly that it's doing: calls the
// exact same functions the three /internal/* endpoints call
// (advisor.runDailyAnalysis, diskMonitor's scan+maintenance sweep, and
// the two maintenance RPCs), directly and locally, right now — the
// same work your external scheduler triggers once a day, useful for
// confirming it still works without waiting for the next scheduled
// call or faking the shared secret over HTTP.

const { log, loadEnv } = require('../../lib/util');
const { tryLoad } = require('../../lib/backendLoader');

module.exports = async function restart() {
  log.step('ROX AI — cron restart (manual trigger, not a process restart)');
  loadEnv();
  log.info('Running the three scheduled jobs now, the same functions /internal/* calls.');

  const advisorResult = tryLoad('src/modules/advisor');
  const optimizerResult = tryLoad('src/modules/optimizer');
  const diskResult = tryLoad('src/modules/diskMonitor');
  const diskMaintenanceResult = tryLoad('src/modules/diskMonitor/maintenance');
  const supabaseResult = tryLoad('lib/supabaseAdmin');

  console.log('');
  log.step('advisor/run-daily');
  if (advisorResult.ok) {
    try {
      const report = await advisorResult.module.runDailyAnalysis({ persist: true });
      log.ok(`Report generated: ${report.insights?.length || 0} insight(s), ${report.risks?.length || 0} risk(s), ${report.recommendations?.length || 0} recommendation(s).`);
      if (optimizerResult.ok) {
        try {
          const sweep = await optimizerResult.module.runAutomaticSweep();
          log.info(`Optimizer sweep: ${sweep.applied?.length || 0} applied, ${sweep.skipped?.length || 0} skipped (reason: ${sweep.reason || 'ran'}).`);
        } catch (err) {
          log.warn(`Optimizer sweep failed: ${err.message}`);
        }
      }
    } catch (err) {
      log.err(`Advisor run failed: ${err.message}`);
      process.exitCode = 1;
    }
  } else {
    log.err(`Could not load advisor module: ${advisorResult.error.message}`);
    process.exitCode = 1;
  }

  console.log('');
  log.step('disk/run-scan');
  if (diskResult.ok) {
    try {
      const report = await diskResult.module.getFullReport();
      log.ok(`Scan complete: ${report.healthLevel}, ${report.totals.usedPct}% used.`);
      const settings = await diskResult.module.getSettings();
      if (settings.autoFixEnabled && diskMaintenanceResult.ok) {
        const results = await diskMaintenanceResult.module.runSafeSweep('auto');
        log.info(`Auto-fix sweep ran (${results.length} action(s)).`);
      } else {
        log.info('Auto-fix is disabled — scan only, no sweep.');
      }
    } catch (err) {
      log.err(`Disk scan failed: ${err.message}`);
      process.exitCode = 1;
    }
  } else {
    log.err(`Could not load diskMonitor module: ${diskResult.error.message}`);
    process.exitCode = 1;
  }

  console.log('');
  log.step('maintenance/run');
  if (supabaseResult.ok) {
    try {
      const { supabaseAdmin } = supabaseResult.module;
      const [mismatches, resets] = await Promise.all([
        supabaseAdmin.rpc('check_credit_audit_mismatches'),
        supabaseAdmin.rpc('reset_monthly_credits'),
      ]);
      if (mismatches.error) log.warn(`check_credit_audit_mismatches: ${mismatches.error.message}`);
      else log.ok(`check_credit_audit_mismatches: ${mismatches.data ?? 0} new alert(s) raised.`);
      if (resets.error) log.warn(`reset_monthly_credits: ${resets.error.message}`);
      else log.ok(`reset_monthly_credits: ${resets.data ?? 0} account(s) reset.`);
    } catch (err) {
      log.err(`Maintenance RPCs failed: ${err.message}`);
      process.exitCode = 1;
    }
  } else {
    log.err(`Could not load lib/supabaseAdmin.js: ${supabaseResult.error.message}`);
    process.exitCode = 1;
  }
};

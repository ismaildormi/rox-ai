// ROX AI — cli/commands/doctor.js
//
// `rox health` answers one question fast ("is everything up?") and is
// what you'd point a monitor at. `rox doctor` is the slower, human-
// facing version: same service checks PLUS a full disk report PLUS
// pending confirmations, meant for "something feels off, what's going
// on" rather than a scripted pass/fail. `--fix` here also runs the
// safe disk maintenance sweep (rox health --fix does not) — still
// never anything from maintenance.js's NEVER_AUTO set.

const path = require('path');
const health = require('./health');
const { BACKEND_DIR, log, loadEnv, getContext } = require('../lib/util');

module.exports = async function doctor(args) {
  const ctx = getContext();
  const fix = args.includes('--fix') || ctx.fix || ctx.repair;
  log.step('ROX AI — doctor' + (fix ? (ctx.repair ? ' (repair enabled)' : ' (fix enabled)') : '') + (ctx.dryRun ? ' [dry-run]' : ''));
  loadEnv();

  console.log('\n== Services ==');
  await health(fix ? ['--fix'] : []);

  console.log('\n== Disk ==');
  const diskMonitor = require(path.join(BACKEND_DIR, 'src', 'modules', 'diskMonitor'));
  const maintenance = require(path.join(BACKEND_DIR, 'src', 'modules', 'diskMonitor', 'maintenance'));

  const report = await diskMonitor.getFullReport();
  console.log(`${diskMonitor.LEVEL_EMOJI[report.healthLevel]} Disk: ${report.healthLevel.toUpperCase()} (${report.totals.usedPct}% used)`);

  if (report.growthFlags.length > 0) {
    log.warn(`${report.growthFlags.length} abnormal growth flag(s) — see \`rox monitor\` for detail.`);
  }

  if (fix && ctx.dryRun && ['warning', 'critical', 'emergency'].includes(report.healthLevel)) {
    log.info('--dry-run: would run the safe maintenance sweep now (temp/cache/old logs/docker images).');
  } else if (fix && ['warning', 'critical', 'emergency'].includes(report.healthLevel)) {
    log.info('Disk usage is elevated — running the safe maintenance sweep…');
    const results = await maintenance.runSafeSweep('admin:cli-doctor');
    const freed = results.reduce((sum, r) => sum + (r.bytes_freed || 0), 0);
    log.ok(`Freed ${diskMonitor.fmtBytes(freed)} via safe cleanup.`);
    const after = await diskMonitor.getFullReport();
    console.log(`${diskMonitor.LEVEL_EMOJI[after.healthLevel]} Disk after cleanup: ${after.healthLevel.toUpperCase()} (${after.totals.usedPct}% used)`);
  }

  const pending = await maintenance.listPendingConfirmations();
  if (pending.length > 0) {
    console.log('');
    log.warn(`${pending.length} action(s) waiting on admin confirmation (\`rox optimize --list-confirmations\`).`);
  }

  if (report.recommendations.length > 0) {
    console.log('\nRecommendations:');
    for (const rec of report.recommendations.slice(0, 5)) console.log(`   - ${rec.message}`);
  }

  console.log('\nDone. Full detail: `rox monitor`. Apply safe cleanups anytime: `rox optimize`.');
};

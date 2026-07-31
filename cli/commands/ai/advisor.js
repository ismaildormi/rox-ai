// ROX AI — cli/commands/ai/advisor.js
//
// Thin CLI view onto backend/src/modules/advisor (already fully built:
// collect -> health/risk/forecast -> insights -> persisted daily report
// + recommendations). This does not reimplement any analysis — it calls
// the exact same runDailyAnalysis()/getLatestReport()/listRecommendations()/
// resolveRecommendation() the admin API routes call, so `rox ai advisor`
// and the admin dashboard can never show different numbers.
//
// Needs SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (backend/.env) — this
// hits the real advisor_daily_reports/advisor_recommendations tables.
//
// Usage:
//   rox ai advisor                        show the latest report + open recommendations
//   rox ai advisor --run                  run analysis now (same as the daily cron) and show it
//   rox ai advisor --resolve <id> <applied|dismissed>   resolve one recommendation
//   rox ai advisor --outcome <id> <outcome> [metric=delta ...]   record the
//     measured result of a resolved recommendation (e.g. `applied_positive`),
//     same as the dashboard's outcome form — metricDelta pairs are parsed as
//     numbers when possible, left as strings otherwise.

const os = require('os');
const { log, loadEnv } = require('../../lib/util');
const { tryLoad } = require('../../lib/aiBackend');

function actorId() {
  return `cli:${os.userInfo().username}`;
}

function printReport(report) {
  const reportDate = report.reportDate || report.report_date;
  const healthScores = report.healthScores || report.health_scores || {};
  const risks = report.risks || [];
  const forecast = report.forecast || {};
  const insights = report.insights || [];

  log.step(`Daily report — ${reportDate}`);

  console.log('  Health scores:');
  for (const [key, score] of Object.entries(healthScores)) {
    console.log(`    ${key}: ${score}`);
  }

  if (insights.length > 0) {
    console.log('  Insights:');
    for (const insight of insights) {
      const text = typeof insight === 'string' ? insight : insight.text;
      console.log(`    - ${text}`);
    }
  }

  if (risks.length > 0) {
    console.log('  Risks:');
    for (const risk of risks) {
      console.log(`    - [${risk.severity || 'unknown'}] ${risk.message || JSON.stringify(risk)}`);
    }
  } else {
    console.log('  Risks: none detected');
  }

  if (Object.keys(forecast).length > 0) {
    console.log('  Forecast:');
    for (const [key, value] of Object.entries(forecast)) {
      console.log(`    ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
  }
}

function printRecommendations(recs) {
  console.log('');
  if (recs.length === 0) {
    log.ok('No open recommendations.');
    return;
  }
  log.step(`Open recommendations (${recs.length})`);
  for (const rec of recs) {
    const actionable = rec.optimizer_actionable ? ' [optimizer-actionable]' : '';
    console.log(`  [${rec.id}] (${rec.category}, confidence ${rec.confidence})${actionable}`);
    console.log(`    ${rec.recommendation}`);
    if (rec.rationale) console.log(`    rationale: ${rec.rationale}`);
  }
  log.info('Resolve one with `rox ai advisor --resolve <id> applied|dismissed`.');
}

module.exports = async function advisor(args = []) {
  log.step('ROX AI — advisor');
  loadEnv();

  const advisorResult = tryLoad('src/modules/advisor');
  if (!advisorResult.ok) {
    log.err(`Could not load the advisor module: ${advisorResult.error.message}`);
    log.info('Needs `npm install` in backend/ and SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY in backend/.env.');
    process.exitCode = 1;
    return;
  }
  const advisorModule = advisorResult.module;

  try {
    if (args.includes('--run')) {
      log.info('Running analysis now (same as the daily cron)…');
      const report = await advisorModule.runDailyAnalysis({ persist: true });
      printReport(report);
      log.ok(report.persisted ? 'Report persisted.' : 'Report generated (not persisted — check the warning above).');
      return;
    }

    const resolveIdx = args.indexOf('--resolve');
    if (resolveIdx !== -1) {
      const id = args[resolveIdx + 1];
      const status = args[resolveIdx + 2];
      if (!id || !status) {
        log.err('Usage: rox ai advisor --resolve <id> <applied|dismissed>');
        process.exitCode = 1;
        return;
      }
      const updated = await advisorModule.resolveRecommendation(id, { status, resolvedBy: actorId() });
      log.ok(`Recommendation ${updated.id} marked ${updated.status}.`);
      return;
    }

    const outcomeIdx = args.indexOf('--outcome');
    if (outcomeIdx !== -1) {
      const id = args[outcomeIdx + 1];
      const outcome = args[outcomeIdx + 2];
      if (!id || !outcome) {
        log.err('Usage: rox ai advisor --outcome <id> <outcome> [metric=delta ...]');
        process.exitCode = 1;
        return;
      }
      const metricDelta = {};
      for (const pair of args.slice(outcomeIdx + 3)) {
        if (!pair.includes('=')) continue;
        const [key, raw] = pair.split('=');
        const num = Number(raw);
        metricDelta[key] = Number.isNaN(num) ? raw : num;
      }
      const updated = await advisorModule.recordOutcome(id, outcome, metricDelta);
      log.ok(`Outcome recorded for recommendation ${updated.id || id}: ${outcome}${Object.keys(metricDelta).length ? ` (${JSON.stringify(metricDelta)})` : ''}`);
      return;
    }

    const report = await advisorModule.getLatestReport();
    if (!report) {
      log.warn('No advisor report yet. Run `rox ai advisor --run` to generate one now, or wait for the daily cron.');
      return;
    }
    printReport(report);
    const recs = await advisorModule.listRecommendations({ status: 'open' });
    printRecommendations(recs);
  } catch (err) {
    log.err(`Advisor call failed: ${err.message}`);
    log.info('Check SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY in backend/.env and that 13_advisor_optimizer_schema.sql has been applied.');
    process.exitCode = 1;
  }
};

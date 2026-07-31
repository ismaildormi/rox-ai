// ROX AI — cli/commands/ai/forecast.js
//
// Just the `forecast` field of the latest advisor report
// (backend/src/modules/advisor/forecast.js's computeForecast() output),
// for when you only care about the projection, not the full report.
// Deliberately does NOT run a new analysis itself — `rox ai advisor
// --run` is the one place a new daily report gets generated, so two
// commands can't race to persist two reports for the same day.

const { log, loadEnv } = require('../../lib/util');
const { tryLoad } = require('../../lib/aiBackend');

module.exports = async function forecast() {
  log.step('ROX AI — forecast');
  loadEnv();

  const advisorResult = tryLoad('src/modules/advisor');
  if (!advisorResult.ok) {
    log.err(`Could not load the advisor module: ${advisorResult.error.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const report = await advisorResult.module.getLatestReport();
    if (!report) {
      log.warn('No advisor report yet. Run `rox ai advisor --run` first.');
      return;
    }
    const forecastData = report.forecast || {};
    if (Object.keys(forecastData).length === 0) {
      log.warn(`Latest report (${report.report_date}) has no forecast data.`);
      return;
    }
    log.step(`Forecast — from the ${report.report_date} report`);
    for (const [key, value] of Object.entries(forecastData)) {
      console.log(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
  } catch (err) {
    log.err(`Could not load forecast: ${err.message}`);
    process.exitCode = 1;
  }
};

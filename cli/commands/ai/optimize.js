// ROX AI — cli/commands/ai/optimize.js
//
// Thin CLI view/control for backend/src/modules/optimizer (Auto
// Optimizer) — same functions the admin API routes call, so nothing is
// reimplemented here: every action still goes through
// assertWithinSafetyRules() and optimizer_actions_log exactly as it
// would from the dashboard.
//
// Usage:
//   rox ai optimize                       show mode, safety rules, recent actions
//   rox ai optimize --mode manual|automatic   change the mode
//   rox ai optimize --sweep               run the automatic-mode sweep now (no-op if mode is manual)
//   rox ai optimize --revert <actionId>   revert a logged action
//   rox ai optimize --safety-rules '<json>'   merge-update safety rules (same
//     shape as settings.safetyRules below, e.g. '{"maxActionsPerDay":10}') —
//     values are merged over the existing rules, never lets a ceiling be
//     removed by omission (same guarantee the dashboard's form gets, since
//     both call optimizer.updateSafetyRules())
//   rox ai optimize --apply '<json action>'   apply one action manually — the
//     same "Apply" button the dashboard has for a single recommendation,
//     goes through the identical assertWithinSafetyRules() check a sweep
//     does. Shape: '{"actionType":"...","overrideKey":"...","newValue":...}'

const os = require('os');
const { log, loadEnv } = require('../../lib/util');
const { tryLoad } = require('../../lib/aiBackend');

function actorId() {
  return `admin:cli:${os.userInfo().username}`;
}

module.exports = async function optimize(args = []) {
  log.step('ROX AI — optimizer');
  loadEnv();

  const optimizerResult = tryLoad('src/modules/optimizer');
  if (!optimizerResult.ok) {
    log.err(`Could not load the optimizer module: ${optimizerResult.error.message}`);
    log.info('Needs `npm install` in backend/ and SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY in backend/.env.');
    process.exitCode = 1;
    return;
  }
  const optimizer = optimizerResult.module;

  try {
    const modeIdx = args.indexOf('--mode');
    if (modeIdx !== -1) {
      const mode = args[modeIdx + 1];
      const updated = await optimizer.setMode(mode, actorId());
      log.ok(`Optimizer mode set to "${updated.mode}".`);
      return;
    }

    if (args.includes('--sweep')) {
      const result = await optimizer.runAutomaticSweep();
      if (result.reason === 'manual_mode') {
        log.warn('Optimizer is in manual mode — sweep is a no-op. Run `rox ai optimize --mode automatic` first if this is intentional.');
        return;
      }
      log.ok(`Sweep complete: ${result.applied.length} applied, ${result.skipped.length} skipped.`);
      for (const a of result.applied) console.log(`  applied: recommendation ${a.id} -> action log ${a.actionLogId}`);
      for (const s of result.skipped) console.log(`  skipped: recommendation ${s.id} (${s.reason})`);
      return;
    }

    const revertIdx = args.indexOf('--revert');
    if (revertIdx !== -1) {
      const id = args[revertIdx + 1];
      if (!id) {
        log.err('Usage: rox ai optimize --revert <actionId>');
        process.exitCode = 1;
        return;
      }
      const reverted = await optimizer.revertAction(id, actorId());
      log.ok(`Action ${reverted.id} reverted.`);
      return;
    }

    const safetyRulesIdx = args.indexOf('--safety-rules');
    if (safetyRulesIdx !== -1) {
      const raw = args[safetyRulesIdx + 1];
      if (!raw) {
        log.err('Usage: rox ai optimize --safety-rules \'{"maxActionsPerDay":10}\'');
        process.exitCode = 1;
        return;
      }
      let rules;
      try {
        rules = JSON.parse(raw);
      } catch (err) {
        log.err(`--safety-rules must be valid JSON: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      const updated = await optimizer.updateSafetyRules(rules, actorId());
      log.ok('Safety rules updated.');
      for (const [key, value] of Object.entries(updated.safetyRules)) {
        console.log(`    ${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
      }
      return;
    }

    const applyIdx = args.indexOf('--apply');
    if (applyIdx !== -1) {
      const raw = args[applyIdx + 1];
      if (!raw) {
        log.err('Usage: rox ai optimize --apply \'{"actionType":"...","overrideKey":"...","newValue":...}\'');
        process.exitCode = 1;
        return;
      }
      let action;
      try {
        action = JSON.parse(raw);
      } catch (err) {
        log.err(`--apply must be valid JSON: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      const applied = await optimizer.applyAction(action, actorId());
      log.ok(`Action applied — logged as ${applied.id || applied.actionLogId || '(no id returned)'}.`);
      return;
    }

    const settings = await optimizer.getSettings();
    log.step(`Mode: ${settings.mode}`);
    console.log('  Safety rules:');
    for (const [key, value] of Object.entries(settings.safetyRules)) {
      console.log(`    ${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
    }

    console.log('');
    const actions = await optimizer.listActions({ limit: 10 });
    log.step(`Recent actions (last ${actions.length})`);
    if (actions.length === 0) {
      log.info('No actions logged yet.');
    }
    for (const a of actions) {
      const reversedNote = a.reversed ? ' [REVERTED]' : '';
      console.log(`  [${a.id}] ${a.created_at} — ${a.action_type} (${a.triggered_by})${reversedNote}`);
      console.log(`    ${a.description}`);
    }
  } catch (err) {
    log.err(`Optimizer call failed: ${err.message}`);
    process.exitCode = 1;
  }
};

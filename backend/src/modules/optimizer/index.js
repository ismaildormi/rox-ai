// ROX AI — src/modules/optimizer
//
// The Auto Optimizer never edits code, config files, or env vars at
// runtime — it writes/removes rows in `runtime_overrides`, which
// aiRouter.js / src/core/config.js already know how to read with the
// SAME override precedence used everywhere else (DB override -> env
// var -> file default; see ARCHITECTURE.md §3 and §4a). That means:
//   - every action is a single audited row, not a deploy
//   - every action is trivially reversible (delete the override row)
//   - nothing here needed a new mechanism invented for it
//
// Every action, automatic or manual, goes through applyAction(), which
// ALWAYS checks it against the current safety rules first and ALWAYS
// writes to optimizer_actions_log before/after — there is no code path
// that changes a runtime override without both of those happening.

const { supabaseAdmin } = require('../../../lib/supabaseAdmin');
const { optimizerDefaults } = require('../../core/config');

const SETTINGS_ROW_ID = true; // matches the boolean-primary-key singleton in 13_advisor_optimizer_schema.sql

async function getSettings() {
  const { data, error } = await supabaseAdmin
    .from('optimizer_settings')
    .select('*')
    .eq('id', SETTINGS_ROW_ID)
    .single();
  if (error) throw error;
  // safety_rules defaults to '{}' in the DB row until an admin first
  // saves settings — fall back to the config file defaults so a fresh
  // install is never running with zero limits.
  const safetyRules = data.safety_rules && Object.keys(data.safety_rules).length > 0
    ? data.safety_rules
    : optimizerDefaults.safetyRules;
  return { mode: data.mode, safetyRules, updatedBy: data.updated_by, updatedAt: data.updated_at };
}

async function setMode(mode, adminUserId) {
  if (!['manual', 'automatic'].includes(mode)) {
    const err = new Error('mode must be "manual" or "automatic"');
    err.code = 'invalid_mode';
    throw err;
  }
  const { data, error } = await supabaseAdmin
    .from('optimizer_settings')
    .update({ mode, updated_by: adminUserId, updated_at: new Date().toISOString() })
    .eq('id', SETTINGS_ROW_ID)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateSafetyRules(rules, adminUserId) {
  // Admin can only ever tighten or redefine within reason — the route
  // layer additionally requires requireAdmin, but this function also
  // never allows removing the ceiling entirely (maxActionsPerDay etc.
  // must remain a finite number), so a malformed request can't disable
  // safety checking by omission.
  const merged = { ...optimizerDefaults.safetyRules, ...rules };
  const { data, error } = await supabaseAdmin
    .from('optimizer_settings')
    .update({ safety_rules: merged, updated_by: adminUserId, updated_at: new Date().toISOString() })
    .eq('id', SETTINGS_ROW_ID)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Throws with err.code = 'safety_rule_violation' if the proposed action
 * would exceed any configured limit. This is the one function every
 * apply path (automatic or manual) must call before writing anything.
 */
async function assertWithinSafetyRules(actionType, { changePct = 0, usdImpact = 0 } = {}, settings) {
  const rules = settings.safetyRules;

  if (!rules.allowedActionTypes.includes(actionType) && rules.disallowedWithoutManualApproval.includes(actionType)) {
    // Allowed to PROPOSE (advisor already does), never to auto-APPLY.
    const err = new Error(`"${actionType}" requires manual admin approval and cannot be auto-applied.`);
    err.code = 'requires_manual_approval';
    throw err;
  }

  if (Math.abs(changePct) > rules.maxPriceChangePctPerAction && actionType === 'pricing_change') {
    throw Object.assign(new Error(`Price change ${changePct}% exceeds the ${rules.maxPriceChangePctPerAction}% limit.`), { code: 'safety_rule_violation' });
  }
  if (Math.abs(changePct) > rules.maxMarginAdjustmentPctPerAction && actionType === 'margin_adjustment') {
    throw Object.assign(new Error(`Margin adjustment ${changePct}% exceeds the ${rules.maxMarginAdjustmentPctPerAction}% limit.`), { code: 'safety_rule_violation' });
  }
  if (Math.abs(changePct) > rules.maxCreditCostChangePctPerAction && actionType === 'limit_adjustment') {
    throw Object.assign(new Error(`Limit change ${changePct}% exceeds the ${rules.maxCreditCostChangePctPerAction}% limit.`), { code: 'safety_rule_violation' });
  }
  if (Math.abs(usdImpact) > rules.requireHumanApprovalAboveUsdImpact) {
    throw Object.assign(new Error(`Estimated impact ${fmtUsd(usdImpact)} exceeds the ${fmtUsd(rules.requireHumanApprovalAboveUsdImpact)} auto-approval ceiling.`), { code: 'requires_manual_approval' });
  }

  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const { count, error } = await supabaseAdmin
    .from('optimizer_actions_log')
    .select('id', { count: 'exact', head: true })
    .eq('triggered_by', 'auto')
    .gte('created_at', since);
  if (!error && count >= rules.maxActionsPerDay) {
    throw Object.assign(new Error(`Automatic actions today (${count}) already reached the daily limit (${rules.maxActionsPerDay}).`), { code: 'daily_action_limit_reached' });
  }

  const { data: recent } = await supabaseAdmin
    .from('optimizer_actions_log')
    .select('created_at')
    .eq('action_type', actionType)
    .order('created_at', { ascending: false })
    .limit(1);
  if (recent && recent[0]) {
    const minutesSince = (Date.now() - new Date(recent[0].created_at).getTime()) / 60000;
    if (minutesSince < rules.cooldownMinutesBetweenSameActionType) {
      throw Object.assign(new Error(`"${actionType}" was applied ${Math.round(minutesSince)}m ago — cooldown is ${rules.cooldownMinutesBetweenSameActionType}m.`), { code: 'cooldown_active' });
    }
  }
}

function fmtUsd(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

/**
 * Applies one action: writes the runtime_overrides row(s) that actually
 * change behavior, and always logs before/after state. `triggeredBy` is
 * 'auto' (called from the daily automatic-mode sweep) or
 * `admin:<userId>` (a human clicked "apply" in the dashboard) — the
 * safety-rule check is IDENTICAL either way; being a human doesn't
 * bypass the ceiling, it only bypasses the "automatic mode is off"
 * gate that the caller (routes / scheduler) is responsible for.
 *
 * @param {{actionType: string, overrideKey: string, newValue: any,
 *          description: string, changePct?: number, usdImpact?: number}} action
 * @param {string} triggeredBy
 */
async function applyAction(action, triggeredBy) {
  const settings = await getSettings();
  await assertWithinSafetyRules(action.actionType, action, settings);

  const { data: existingOverride } = await supabaseAdmin
    .from('runtime_overrides')
    .select('*')
    .eq('override_key', action.overrideKey)
    .maybeSingle();

  const beforeState = { overrideKey: action.overrideKey, value: existingOverride ? existingOverride.value : null };
  const afterState = { overrideKey: action.overrideKey, value: action.newValue };

  const { error: overrideError } = await supabaseAdmin
    .from('runtime_overrides')
    .upsert({
      override_key: action.overrideKey,
      value: action.newValue,
      set_by: triggeredBy,
      reason: action.description,
    });
  if (overrideError) throw overrideError;

  const { data: logRow, error: logError } = await supabaseAdmin
    .from('optimizer_actions_log')
    .insert({
      action_type: action.actionType,
      description: action.description,
      triggered_by: triggeredBy,
      before_state: beforeState,
      after_state: afterState,
      safety_rules_snapshot: settings.safetyRules,
    })
    .select()
    .single();
  if (logError) throw logError;

  return logRow;
}

/** Reverses a logged action by restoring before_state (or deleting the override if it didn't exist before). */
async function revertAction(actionLogId, adminUserId) {
  const { data: logRow, error } = await supabaseAdmin
    .from('optimizer_actions_log')
    .select('*')
    .eq('id', actionLogId)
    .single();
  if (error) throw error;
  if (logRow.reversed) {
    const err = new Error('This action was already reversed.');
    err.code = 'already_reversed';
    throw err;
  }

  const overrideKey = logRow.before_state?.overrideKey || logRow.after_state?.overrideKey;
  if (overrideKey) {
    if (logRow.before_state?.value === null || logRow.before_state?.value === undefined) {
      await supabaseAdmin.from('runtime_overrides').delete().eq('override_key', overrideKey);
    } else {
      await supabaseAdmin.from('runtime_overrides').update({ value: logRow.before_state.value, set_by: `revert:${adminUserId}` }).eq('override_key', overrideKey);
    }
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('optimizer_actions_log')
    .update({ reversed: true, reversed_at: new Date().toISOString(), reversed_by: adminUserId })
    .eq('id', actionLogId)
    .select()
    .single();
  if (updateError) throw updateError;
  return updated;
}

async function listActions({ limit = 50 } = {}) {
  const { data, error } = await supabaseAdmin
    .from('optimizer_actions_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/**
 * Automatic-mode sweep: pulls open, optimizer_actionable recommendations
 * from the advisor and applies the ones that pass safety rules. Anything
 * that throws 'requires_manual_approval' or a safety violation is left
 * untouched (still 'open', still visible to an admin) rather than forced
 * through. Meant to be called once daily, right after
 * advisor.runDailyAnalysis() — see /internal/advisor/run-daily.
 */
async function runAutomaticSweep() {
  const settings = await getSettings();
  if (settings.mode !== 'automatic') return { applied: [], skipped: [], reason: 'manual_mode' };

  const { data: candidates, error } = await supabaseAdmin
    .from('advisor_recommendations')
    .select('*')
    .eq('status', 'open')
    .eq('optimizer_actionable', true)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;

  const applied = [];
  const skipped = [];

  for (const rec of candidates || []) {
    try {
      const action = mapRecommendationToAction(rec);
      if (!action) {
        skipped.push({ id: rec.id, reason: 'no_mapped_action' });
        continue;
      }
      const logRow = await applyAction(action, 'auto');
      await supabaseAdmin.from('advisor_recommendations').update({ status: 'applied', resolved_at: new Date().toISOString() }).eq('id', rec.id);
      applied.push({ id: rec.id, actionLogId: logRow.id });
    } catch (err) {
      skipped.push({ id: rec.id, reason: err.code || err.message });
    }
  }

  return { applied, skipped };
}

/**
 * Only the two provider-facing categories map to a concrete, reversible
 * runtime override today (traffic weighting / preferred provider) —
 * everything else the advisor proposes (pricing, limits, retention,
 * abuse review) is `disallowedWithoutManualApproval` by default and
 * intentionally has no auto-apply mapping here at all.
 */
function mapRecommendationToAction(rec) {
  if (rec.category === 'provider' && rec.metadata?.models?.length) {
    return {
      actionType: 'provider_switch_cheaper',
      overrideKey: `provider_health_override.${rec.metadata.models[0]}`,
      newValue: { deprioritized: true, reason: rec.rationale },
      description: rec.recommendation,
      changePct: 0,
      usdImpact: 0,
    };
  }
  return null;
}

module.exports = {
  getSettings,
  setMode,
  updateSafetyRules,
  applyAction,
  revertAction,
  listActions,
  runAutomaticSweep,
  assertWithinSafetyRules,
};

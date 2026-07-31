// ROX AI — Gatekeeper (hardened)
//
// The original flow deducted credits AFTER the AI call completed
// (server.js called logCreditEvent post-hoc), and image/video jobs
// never deducted anything before being enqueued at all — a burst of
// requests could fill the queue for free before any charge landed.
// checkAccess() also only read the balance; nothing locked the row,
// so two concurrent requests could both pass the check.
//
// Fixed flow: reserveCredits() now performs the atomic, row-locked,
// idempotent charge from 06_hardening_idempotent_deduct.sql BEFORE
// any model is called or any job is enqueued. If the work later fails
// (all fallback models down, or a queued job exhausts its retries),
// refundCredits() reverses that exact charge by requestId.

const { supabaseAdmin } = require('./lib/supabaseAdmin');

async function checkAccess(userId) {
  const { data: user, error } = await supabaseAdmin
    .from('profiles')
    .select('subscription_status, credits_total, credits_used')
    .eq('id', userId)
    .single();

  if (error || !user) return { allowed: false, reason: 'user_not_found' };

  // Pro is no longer an unconditional bypass — it's a bigger, paid-for
  // credit pool (500/month, ~50% guaranteed margin on the $10 plan; see
  // stripeWebhook.js and 08_maintenance.sql). Out-of-credits Pro users
  // are offered a top-up (see /api/create-topup-session) instead of
  // being blocked with no path forward.
  const remaining = user.credits_total - user.credits_used;
  if (remaining <= 0) {
    return { allowed: false, reason: 'out_of_credits', user };
  }

  return { allowed: true, user, remaining };
}

// Cheap pre-flight check only — gives a fast 403 for the obviously-out-
// -of-credits case without doing a row-locked write. Real enforcement
// happens in reserveCredits(), which is safe under concurrency even if
// this middleware is skipped or races with another request.
async function gatekeeperMiddleware(req, res, next) {
  const access = await checkAccess(req.userId);

  if (!access.allowed) {
    const isPro = access.user && access.user.subscription_status === 'pro';
    return res.status(403).json({
      status: 'error',
      message: isPro
        ? 'استهلكتي الرصيد الشهري ديال Pro. اشحن رصيد إضافي للمتابعة.'
        : 'Crédit insuffisant. Passez au plan Pro pour continuer.',
      code: isPro ? 'pro_out_of_credits' : 'out_of_credits',
    });
  }

  req.roxUser = access.user;
  next();
}

/**
 * Atomically reserves (charges) credits for one requestId, BEFORE any
 * model call or queue enqueue happens. Row-locked and idempotent: a
 * retry with the same requestId will never double-charge.
 * Throws with err.code = 'insufficient_credits' | 'user_not_found' on failure.
 */
async function reserveCredits({ userId, requestId, feature, modelUsed = null, creditsConsumed = 1 }) {
  if (!requestId) {
    throw new Error('reserveCredits requires a requestId for idempotency');
  }

  const { data, error } = await supabaseAdmin.rpc('deduct_credit_and_log', {
    p_user_id: userId,
    p_feature: feature,
    p_model_used: modelUsed,
    p_fallback_triggered: false,
    p_credits_consumed: creditsConsumed,
    p_status: 'success',
    p_request_id: requestId,
  });

  if (error) throw error;
  if (!data.success) {
    const err = new Error(data.error);
    err.code = data.error; // 'insufficient_credits' | 'user_not_found'
    err.available = data.available;
    err.required = data.required;
    throw err;
  }

  return { newBalance: data.new_balance, replayed: !!data.replayed };
}

/**
 * Reverses the charge tied to requestId (e.g. all fallback models
 * failed, or a queued job exhausted its retries). Safe to call more
 * than once for the same requestId — only refunds once.
 */
async function refundCredits(requestId) {
  const { data, error } = await supabaseAdmin.rpc('refund_credit_and_log', { p_request_id: requestId });
  if (error) throw error;
  if (!data.success) {
    const err = new Error(data.error);
    err.code = data.error;
    throw err;
  }
  return { newBalance: data.new_balance, alreadyRefunded: !!data.already_refunded };
}

/**
 * Logging-only call for outcomes that never charged anything (a
 * blocked request, or an error where reserveCredits() itself never
 * ran). Kept separate from reserveCredits so charging and logging
 * can't be confused with each other.
 */
async function logCreditEvent({
  userId, feature, modelUsed = 'n/a', fallbackTriggered = false,
  status, requestId = null, errorMessage = null, metadata = {},
}) {
  const { error } = await supabaseAdmin.rpc('deduct_credit_and_log', {
    p_user_id: userId,
    p_feature: feature,
    p_model_used: modelUsed,
    p_fallback_triggered: fallbackTriggered,
    p_credits_consumed: 0,
    p_status: status,
    p_request_id: requestId,
    p_error_message: errorMessage,
    p_metadata: metadata,
  });

  if (error) {
    console.error('[gatekeeper] logCreditEvent failed:', error.message);
  }
}

/**
 * Call this when refundCredits() itself throws (rare, but it means the
 * user was charged and the refund did not go through). console.error
 * alone is easy to miss; this persists it to refund_failures +
 * system_alerts (08_maintenance.sql) so it shows up in a query/alert
 * instead of only in logs, and stays open until someone resolves it
 * manually (a support agent crediting the account back, or a re-run
 * of refundCredits once the underlying issue is fixed).
 */
async function reportRefundFailure({ requestId, userId, feature, error }) {
  const message = error?.message || String(error);
  console.error(`[gatekeeper] REFUND FAILED for requestId=${requestId} userId=${userId}:`, message);

  const { error: rpcError } = await supabaseAdmin.rpc('log_refund_failure', {
    p_request_id: requestId,
    p_user_id: userId,
    p_feature: feature,
    p_error_message: message,
  });

  if (rpcError) {
    // Last resort — even the failure-tracking write failed. Nothing left
    // to persist to, so this line in the logs is the only record.
    console.error('[gatekeeper] could not persist refund failure either:', rpcError.message);
  }
}

module.exports = {
  checkAccess,
  gatekeeperMiddleware,
  reserveCredits,
  refundCredits,
  logCreditEvent,
  reportRefundFailure,
};

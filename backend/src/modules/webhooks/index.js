// ROX AI — src/modules/webhooks
// Extension point for "Webhooks" (flag: webhooks). Emits events other
// systems already generate (a completed generation job, a credit
// top-up, a plan change) to user-registered URLs. Deliberately just a
// dispatch function for now — no retry/backoff queue yet, because that
// should reuse the existing BullMQ setup (lib/queue.js) rather than
// invent a second queue system when this is built for real.
//
// Storage: table `webhooks` (url, secret, subscribed_events[], owner)
// — see 12_extension_schema.sql.

async function dispatch(/* eventName, payload, ownerId */) {
  // no-op until implemented; callers should not assume delivery
  return { delivered: false, reason: 'not_implemented' };
}

module.exports = { dispatch };

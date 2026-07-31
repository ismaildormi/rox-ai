// ROX AI — lib/metrics.js
// Nothing in the original backend exposed any metrics. `attempts` was
// logged into credit_audit_log.metadata per-request, which is fine for
// debugging one user's ticket, but there was no aggregate view — no way
// to see "how often are we falling back to DeepSeek this hour" or
// "is the image queue backing up" without hand-querying Supabase.
// Mount register at GET /metrics (see server.js) and point Prometheus/
// Grafana Cloud/Railway metrics at it.

const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const fallbackCounter = new client.Counter({
  name: 'rox_fallback_total',
  help: 'Requests where the primary model failed and a fallback model served the response',
  labelNames: ['feature', 'primary_model', 'fallback_model'],
  registers: [register],
});

const modelLatency = new client.Histogram({
  name: 'rox_model_latency_ms',
  help: 'Latency of individual model calls in milliseconds',
  labelNames: ['model'],
  buckets: [100, 250, 500, 1000, 2500, 5000, 10000, 15000, 30000],
  registers: [register],
});

const modelOutcome = new client.Counter({
  name: 'rox_model_outcome_total',
  help: 'Outcome of individual model call attempts',
  labelNames: ['model', 'outcome'], // outcome: success | failure
  registers: [register],
});

const queueDepth = new client.Gauge({
  name: 'rox_queue_depth',
  help: 'Waiting jobs in a BullMQ queue',
  labelNames: ['queue'],
  registers: [register],
});

const refundCounter = new client.Counter({
  name: 'rox_refund_total',
  help: 'Credit refunds issued after a job failed all retries',
  labelNames: ['feature'],
  registers: [register],
});

// --- Margin observability (added alongside lib/loadGuard.js) ---
// Before this, the only signal for "are we still profitable under
// traffic" was manually querying credit_audit_log. These make it a
// dashboard number: cumulative real cost, and a live per-feature margin
// snapshot (revenue-per-credit minus cost of the model that answered).
const costCounter = new client.Counter({
  name: 'rox_model_cost_usd_total',
  help: 'Cumulative estimated USD cost of model calls (lib/modelCosts.js), by model',
  labelNames: ['model'],
  registers: [register],
});

const marginGauge = new client.Gauge({
  name: 'rox_margin_usd_last_request',
  help: 'credit revenue minus API cost for the most recent request on this feature (USD, can go negative)',
  labelNames: ['feature'],
  registers: [register],
});

const loadLevelGauge = new client.Gauge({
  name: 'rox_load_level',
  help: 'Current global load level used for margin-aware routing (0=normal, 1=elevated, 2=high)',
  labelNames: ['feature'],
  registers: [register],
});

function recordFallback(feature, primaryModel, fallbackModel) {
  fallbackCounter.inc({ feature, primary_model: primaryModel, fallback_model: fallbackModel });
}
function recordModelLatency(model, ms) {
  modelLatency.observe({ model }, ms);
}
function recordModelOutcome(model, outcome) {
  modelOutcome.inc({ model, outcome });
}
function setQueueDepth(queue, depth) {
  queueDepth.set({ queue }, depth);
}
function recordRefund(feature) {
  refundCounter.inc({ feature });
}
function recordCost(model, usd) {
  costCounter.inc({ model }, usd);
}
function recordMargin(feature, usd) {
  marginGauge.set({ feature }, usd);
}
function recordLoadLevel(feature, level) {
  const LEVEL_TO_NUMBER = { normal: 0, elevated: 1, high: 2 };
  loadLevelGauge.set({ feature }, LEVEL_TO_NUMBER[level] ?? 0);
}

module.exports = {
  register,
  recordFallback,
  recordModelLatency,
  recordModelOutcome,
  setQueueDepth,
  recordRefund,
  recordCost,
  recordMargin,
  recordLoadLevel,
};

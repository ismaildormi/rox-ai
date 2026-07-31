// ROX AI — src/modules/advisor/insights.js
//
// Turns the raw snapshot (collect.js) + health scores (health.js) +
// risks (risk.js) into the three things an admin actually reads:
//   - insights: past-tense sentences ("Revenue increased by 12%...")
//   - opportunities: pattern-detection sentences ("This feature has
//     high demand...")
//   - recommendations: forward-looking, actionable suggestions, each
//     tagged with a category and whether the Auto Optimizer is allowed
//     to act on it (optimizerActionable) — pricing/limit changes never
//     are; provider/model/cache suggestions may be, subject to
//     src/modules/optimizer's own safety-rule check.
//
// Every sentence here is generated FROM a specific number in the
// snapshot — nothing is templated language dressed up to look like
// analysis. pct()/fmtUsd() below exist so the same phrasing is used
// everywhere instead of ad hoc string building per insight.

const { advisor: config } = require('../../core/config');

function pct(from, to) {
  if (!from) return to > 0 ? 100 : 0;
  return Math.round(((to - from) / Math.abs(from)) * 1000) / 10;
}

function fmtUsd(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function insight(text, metric = {}) {
  return { text, metric };
}

function recommendation(category, text, rationale, { optimizerActionable = false, confidence = 0.5, metadata = {} } = {}) {
  return { category, recommendation: text, rationale, optimizerActionable, confidence, metadata };
}

function opportunity(text, metadata = {}) {
  return { text, metadata };
}

// --- Insights: what happened ------------------------------------------------

function buildInsights(snapshot) {
  const t = snapshot.today || {};
  const y = snapshot.yesterday || {};
  const notable = config.insights.notableChangePct;
  const out = [];

  const revenueChange = pct(y.revenue_usd, t.revenue_usd);
  if (Math.abs(revenueChange) / 100 >= notable) {
    out.push(insight(
      `Revenue ${revenueChange >= 0 ? 'increased' : 'decreased'} by ${Math.abs(revenueChange)}% compared to yesterday (${fmtUsd(y.revenue_usd)} → ${fmtUsd(t.revenue_usd)}).`,
      { revenueChangePct: revenueChange }
    ));
  }

  const costChange = pct(y.ai_cost_usd, t.ai_cost_usd);
  if (Math.abs(costChange) / 100 >= notable) {
    out.push(insight(
      `AI costs ${costChange >= 0 ? 'increased' : 'decreased'} by ${Math.abs(costChange)}% compared to yesterday (${fmtUsd(y.ai_cost_usd)} → ${fmtUsd(t.ai_cost_usd)}).`,
      { aiCostChangePct: costChange }
    ));
  }

  const videoJobsChange = pct(y.video_jobs, t.video_jobs);
  if (t.video_jobs > 0 && Math.abs(videoJobsChange) / 100 >= notable) {
    out.push(insight(`Video generation volume ${videoJobsChange >= 0 ? 'increased' : 'decreased'} by ${Math.abs(videoJobsChange)}% compared to yesterday.`));
  }

  const imageJobsChange = pct(y.image_jobs, t.image_jobs);
  if (t.image_jobs > 0 && Math.abs(imageJobsChange) / 100 >= notable) {
    out.push(insight(`Image generation volume ${imageJobsChange >= 0 ? 'increased' : 'decreased'} by ${Math.abs(imageJobsChange)}% compared to yesterday.`));
  }

  // Profit leader: highest-margin feature/model combo over the last 24h,
  // among combos with enough volume to be meaningful (not a single lucky request).
  const meaningfulCombos = (snapshot.margin24h || []).filter((m) => m.requests >= config.insights.profitLeaderMinRequests);
  const profitLeader = meaningfulCombos.slice().sort((a, b) => Number(b.margin_usd) - Number(a.margin_usd))[0];
  if (profitLeader && Number(profitLeader.margin_usd) > 0) {
    out.push(insight(`${profitLeader.feature} (${profitLeader.model_used}) is producing the highest profit over the last 24h: ${fmtUsd(profitLeader.margin_usd)} across ${profitLeader.requests} requests.`));
  }

  // MRR direction: use the trailing 7-day revenue slope as a proxy for
  // "monthly recurring revenue is growing" since there's no separate
  // MRR ledger — see ARCHITECTURE.md note on what a real MRR metric needs.
  const series = snapshot.dailySeries || [];
  const last7 = series.slice(-7);
  if (last7.length >= 2) {
    const firstHalf = last7.slice(0, Math.ceil(last7.length / 2)).reduce((s, r) => s + Number(r.revenue_usd || 0), 0);
    const secondHalf = last7.slice(Math.ceil(last7.length / 2)).reduce((s, r) => s + Number(r.revenue_usd || 0), 0);
    if (firstHalf > 0 || secondHalf > 0) {
      out.push(insight(`Revenue is ${secondHalf >= firstHalf ? 'trending up' : 'trending down'} over the last 7 days (proxy for MRR — no dedicated MRR ledger yet).`));
    }
  }

  if (out.length === 0) {
    out.push(insight('No notable day-over-day changes — metrics are stable.'));
  }

  return out;
}

// --- Opportunities: patterns worth acting on --------------------------------

function buildOpportunities(snapshot) {
  const out = [];
  const thresholds = config.recommendations;

  for (const combo of snapshot.margin24h || []) {
    const dailyRate = combo.requests; // this table is already a 24h window
    if (dailyRate >= thresholds.premiumCandidateMinDailyRequests && Number(combo.margin_usd) <= thresholds.premiumCandidateMaxMarginUsd) {
      out.push(opportunity(`${combo.feature} has high demand (${dailyRate} requests/24h) but low/negative margin (${fmtUsd(combo.margin_usd)}) — consider making it Premium-only or repricing it.`, combo));
    } else if (dailyRate >= thresholds.premiumCandidateMinDailyRequests) {
      out.push(opportunity(`${combo.feature} has high demand (${dailyRate} requests/24h).`, combo));
    }
    if (Number(combo.margin_usd) < 0) {
      out.push(opportunity(`${combo.feature} (${combo.model_used}) is losing money: ${fmtUsd(combo.margin_usd)} over the last 24h.`, combo));
    }
  }

  for (const model of snapshot.modelHealth || []) {
    if (model.state === 'open') {
      out.push(opportunity(`${model.model} has become unreliable/expensive to keep in the fallback chain (circuit currently open) — consider deprioritizing it.`, model));
    }
  }

  // Funnel/behavioral opportunities ("users abandon after step 3",
  // "AI Agent users convert 4x more") need event-level funnel and
  // cohort data this platform doesn't capture yet (analytics_events
  // exists but nothing populates a step/funnel field today). Flagged
  // explicitly rather than fabricated.
  out.push(opportunity('Funnel drop-off and feature-to-conversion correlation (e.g. "users abandon after step 3", "AI Agent users convert 4x more") require step-level analytics events not yet collected — see ARCHITECTURE.md §11 for what to add.'));

  return out;
}

// --- Recommendations: what to do next ---------------------------------------

function buildRecommendations(snapshot, health, risks) {
  const out = [];
  const thresholds = config.recommendations;

  for (const combo of snapshot.margin24h || []) {
    if (Number(combo.margin_usd) < 0 && combo.requests >= 5) {
      out.push(recommendation(
        'pricing',
        `Increase the credit cost of ${combo.feature} (currently net-negative on ${combo.model_used}).`,
        `${combo.feature}/${combo.model_used} lost ${fmtUsd(Math.abs(combo.margin_usd))} over ${combo.requests} requests in the last 24h.`,
        { optimizerActionable: false, confidence: 0.6, metadata: combo }
      ));
    }
    if (Number(combo.avg_margin_usd_per_request) > 0 && combo.requests < 5) {
      out.push(recommendation(
        'pricing',
        `Consider lowering the credit cost of ${combo.feature} to drive volume.`,
        `Margin per request is healthy (${fmtUsd(combo.avg_margin_usd_per_request)}) but volume is low (${combo.requests}/24h) — price may be suppressing demand.`,
        { optimizerActionable: false, confidence: 0.3, metadata: combo }
      ));
    }
  }

  const trippedModels = (snapshot.modelHealth || []).filter((m) => m.state === 'open');
  if (trippedModels.length > 0) {
    out.push(recommendation(
      'provider',
      `Switch traffic away from ${trippedModels.map((m) => m.model).join(', ')} toward a healthy provider until it recovers.`,
      'Circuit breaker is open for these models — they are currently failing or too slow.',
      { optimizerActionable: true, confidence: 0.8, metadata: { models: trippedModels.map((m) => m.model) } }
    ));
  }

  const negativeCombos = (snapshot.margin24h || []).filter((m) => Number(m.margin_usd) < config.riskThresholds?.financial?.negativeComboFloorUsd || 0);
  for (const combo of negativeCombos) {
    out.push(recommendation(
      'model',
      `Use a cheaper model for ${combo.feature} instead of ${combo.model_used}.`,
      `${combo.model_used} is currently the most expensive model serving this feature and margin is negative.`,
      { optimizerActionable: true, confidence: 0.6, metadata: combo }
    ));
  }

  // Free-tier limit recommendation, based on daily chat volume trend.
  const series = snapshot.dailySeries || [];
  const recentChat = series.slice(-7).map((r) => Number(r.chat_requests || 0));
  if (recentChat.length >= 2) {
    const trendUp = recentChat[recentChat.length - 1] > recentChat[0] * (1 + thresholds.highDemandGrowthPct);
    const financial = health.financial;
    if (trendUp && financial < 50) {
      out.push(recommendation(
        'limits',
        'Decrease the free message limit.',
        'Free chat volume is growing quickly while financial health is weak — free usage may be outpacing what current margins support.',
        { optimizerActionable: false, confidence: 0.4 }
      ));
    } else if (!trendUp && financial >= 70) {
      out.push(recommendation(
        'limits',
        'Consider increasing the free message limit to improve conversion.',
        'Financial health is strong and free chat volume is flat — there may be room to make the free tier more generous without hurting margin.',
        { optimizerActionable: false, confidence: 0.3 }
      ));
    }
  }

  // Risk-derived recommendations.
  for (const r of risks) {
    if (r.type === 'expensive_user') {
      out.push(recommendation('abuse', `Review user ${r.metadata.userId} — flagged as a high-cost/high-volume account.`, r.message, { optimizerActionable: false, confidence: 0.5, metadata: r.metadata }));
    }
    if (r.type === 'suspicious_account') {
      out.push(recommendation('abuse', `Investigate user ${r.metadata.userId} for possible abuse.`, r.message, { optimizerActionable: false, confidence: 0.5, metadata: r.metadata }));
    }
    if (r.type === 'low_profit_margin') {
      out.push(recommendation('pricing', 'Review pricing across the board — overall margin is below the safe floor.', r.message, { optimizerActionable: false, confidence: 0.7 }));
    }
    if (r.type === 'server_overload') {
      out.push(recommendation('infra', 'Investigate job failures — consider scaling worker capacity or adding retries.', r.message, { optimizerActionable: true, confidence: 0.5, metadata: r.metadata }));
    }
  }

  // Inactive-user discount / upgrade suggestions need a real
  // last-active timestamp per user; profiles has last_reset_date which
  // is a credit-cycle marker, not a login/activity timestamp. Flagged
  // rather than computed from the wrong column.
  out.push(recommendation(
    'retention',
    'Offer discounts to inactive users / recommend subscription upgrades to high-usage free users.',
    'Needs a real last-active-at timestamp per user (profiles.last_reset_date is a credit-cycle marker, not activity) — add one before this can be computed, not estimated.',
    { optimizerActionable: false, confidence: 0.2 }
  ));

  return out;
}

module.exports = { buildInsights, buildOpportunities, buildRecommendations };

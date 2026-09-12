'use strict';

const registry = require('../config/cost-registry.v1.json');
const { integer, ceilDiv, financialError } = require('./exactMoney');

const UNIT_TYPES = new Set([
  'tokens',
  'cached_tokens',
  'requests',
  'searches',
  'images',
  'video_seconds',
  'audio_seconds',
  'audio_minutes',
  'transcription_minutes',
  'speech_characters',
  'music_seconds',
  'file_pages',
  'file_bytes',
  'processing_operations',
  'code_execution_milliseconds',
  'computer_control_actions',
  'computer_control_seconds',
  'storage_byte_hours',
  'queued_job_seconds',
  'build_jobs',
  'runtime_seconds',
  'preview_seconds',
  'egress_bytes',
  'idle_session_seconds'
]);

const REQUIRED_FIELDS = [
  'id',
  'provider',
  'modelToolId',
  'capability',
  'operationType',
  'unitType',
  'unitScale',
  'currency',
  'creditConversionResult',
  'currencyChangeReserveBps',
  'safetyReserveBps',
  'infrastructureReserveMicroUsd',
  'targetGrossMarginBps',
  'verificationStatus',
  'enabledState',
  'pricingSource',
  'pricingSourceUrl',
  'pricingEffectiveDate',
  'pricingReviewBefore'
];

const RESOLVABLE_VERIFICATION_STATES = new Set([
  'verified',
  'conditional_repository_verified',
  'conditional_operator_configured'
]);

const ENABLED_STATES = new Set(['enabled', 'conditional', 'blocked']);

function registryError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateRegistry(value = registry) {
  if (!value || typeof value.version !== 'string' || !value.version.trim()) {
    throw registryError('invalid_cost_registry_version');
  }

  if (value.currency !== 'USD' || !Array.isArray(value.entries)) {
    throw registryError('invalid_cost_registry');
  }

  const ids = new Set();

  for (const entry of value.entries) {
    for (const field of REQUIRED_FIELDS) {
      if (entry[field] === undefined || entry[field] === '') {
        throw registryError(`invalid_cost_entry_${entry.id || 'unknown'}_${field}`);
      }
    }

    if (ids.has(entry.id)) {
      throw registryError(`duplicate_cost_entry_${entry.id}`);
    }
    ids.add(entry.id);

    if (!UNIT_TYPES.has(entry.unitType)) {
      throw registryError(`invalid_cost_unit_${entry.id}`);
    }

    if (entry.currency !== value.currency) {
      throw registryError(`invalid_cost_currency_${entry.id}`);
    }

    if (!ENABLED_STATES.has(entry.enabledState)) {
      throw registryError(`invalid_cost_enabled_state_${entry.id}`);
    }

    integer(entry.unitScale, `${entry.id}_unit_scale`, { allowZero: false });

    for (const field of ['pricingEffectiveDate', 'pricingReviewBefore']) {
      if (entry[field] !== null && entry[field] !== undefined) {
        const parsed = Date.parse(entry[field]);
        if (!Number.isFinite(parsed)) {
          throw registryError(`invalid_${field}_${entry.id}`);
        }
      }
    }
  }

  return value;
}

function findCostEntries(query, value = registry) {
  validateRegistry(value);
  const fields = ['provider', 'modelToolId', 'capability', 'operationType'];
  return value.entries.filter(entry =>
    fields.every(field => query[field] === undefined || entry[field] === query[field])
  );
}

function findCostEntry(query, value = registry) {
  const matches = findCostEntries(query, value);
  if (matches.length > 1) {
    throw registryError('ambiguous_cost_entry');
  }
  return matches[0] || null;
}

function parseNow(now) {
  if (typeof now === 'number' && Number.isFinite(now)) return now;
  if (now instanceof Date && Number.isFinite(now.getTime())) return now.getTime();
  throw registryError('invalid_cost_lookup_time');
}

function assertFresh(entry, now) {
  const at = parseNow(now);

  if (!entry.pricingEffectiveDate) {
    throw registryError('cost_entry_effective_date_missing');
  }
  if (!entry.pricingReviewBefore) {
    throw registryError('cost_entry_review_date_missing');
  }

  const effective = Date.parse(entry.pricingEffectiveDate);
  const reviewBefore = Date.parse(entry.pricingReviewBefore);

  if (!Number.isFinite(effective) || !Number.isFinite(reviewBefore) || reviewBefore <= effective) {
    throw registryError('cost_entry_invalid_date_window');
  }
  if (at < effective) {
    throw registryError('cost_entry_not_yet_effective');
  }
  if (at >= reviewBefore) {
    throw registryError('cost_entry_expired');
  }
}

function usdEnvironmentToMicroUsd(raw, name) {
  const text = String(raw ?? '').trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(text)) {
    throw registryError(`invalid_runtime_price_${name}`);
  }

  const [whole, fraction = ''] = text.split('.');
  const micro = BigInt(whole) * 1000000n + BigInt((fraction + '000000').slice(0, 6));

  if (micro <= 0n) {
    throw registryError(`invalid_runtime_price_${name}`);
  }
  return micro.toString();
}

function resolveCostEntry(query, {
  env = process.env,
  now = Date.now(),
  value = registry
} = {}) {
  const entry = findCostEntry(query, value);

  if (!entry) {
    throw registryError('unknown_cost_entry');
  }

  if (entry.enabledState === 'blocked') {
    throw registryError('cost_entry_blocked');
  }

  if (!RESOLVABLE_VERIFICATION_STATES.has(entry.verificationStatus)) {
    throw registryError('cost_entry_unverified');
  }

  assertFresh(entry, now);

  if (entry.verificationStatus === 'conditional_operator_configured') {
    if (!entry.providerCredentialEnvironment || !env[entry.providerCredentialEnvironment]) {
      throw registryError('cost_entry_condition_not_met');
    }
    if (!entry.runtimePriceEnvironment || !env[entry.runtimePriceEnvironment]) {
      throw registryError('cost_entry_runtime_price_missing');
    }

    return Object.freeze({
      ...entry,
      fixedOperationPriceMicroUsd: usdEnvironmentToMicroUsd(
        env[entry.runtimePriceEnvironment],
        entry.runtimePriceEnvironment
      ),
      resolvedPricingSource: `environment:${entry.runtimePriceEnvironment}`,
      registryVersion: value.version
    });
  }

  if (entry.enabledState === 'conditional') {
    const requirement = entry.requiredEnvironment;
    if (!requirement || env[requirement.name] !== requirement.value) {
      throw registryError('cost_entry_condition_not_met');
    }
  }

  return Object.freeze({ ...entry, registryVersion: value.version });
}

function optionalMoney(value, name) {
  return value === null || value === undefined ? null : integer(value, name);
}

function estimateProviderCostMicroUsd(entry, usage = {}) {
  const unitScale = integer(entry.unitScale, 'unit_scale', { allowZero: false });
  const fixedPrice = optionalMoney(entry.fixedOperationPriceMicroUsd, 'fixed_operation_price_micro_usd');
  const minimum = optionalMoney(entry.minimumBillableMicroUsd, 'minimum_billable_micro_usd');
  const inputPrice = optionalMoney(entry.inputUnitPriceMicroUsd, 'input_unit_price_micro_usd');
  const outputPrice = optionalMoney(entry.outputUnitPriceMicroUsd, 'output_unit_price_micro_usd');
  const cachedPrice = optionalMoney(entry.cachedUnitPriceMicroUsd, 'cached_unit_price_micro_usd');

  if (fixedPrice === null && inputPrice === null && outputPrice === null) {
    throw financialError('price_measurement_unavailable');
  }

  let total = fixedPrice || 0n;
  const inputUnits = integer(
    usage.inputUnits ?? usage.units ?? usage.input_tokens ?? usage.prompt_tokens ?? 0,
    'input_units'
  );
  const outputUnits = integer(
    usage.outputUnits ?? usage.output_tokens ?? usage.completion_tokens ?? 0,
    'output_units'
  );
  const cachedUnits = integer(
    usage.cachedUnits ?? usage.cached_tokens ?? 0,
    'cached_units'
  );

  if (inputUnits > 0n && inputPrice === null) throw financialError('input_price_unavailable');
  if (outputUnits > 0n && outputPrice === null) throw financialError('output_price_unavailable');
  if (cachedUnits > 0n && cachedPrice === null) throw financialError('cached_price_unavailable');

  const variableCostNumerator = inputUnits * (inputPrice || 0n) + outputUnits * (outputPrice || 0n) + cachedUnits * (cachedPrice || 0n);
  total += ceilDiv(variableCostNumerator, unitScale);


  if (minimum !== null && total < minimum) total = minimum;
  return total.toString();
}

function resolveCostQuote(query, usage = {}, options = {}) {
  const entry = resolveCostEntry(query, options);
  const providerCostMicroUsd = estimateProviderCostMicroUsd(entry, usage);

  return Object.freeze({
    pricingVersion: entry.registryVersion || registry.version,
    costEntryId: entry.id,
    provider: entry.provider,
    modelToolId: entry.modelToolId,
    capability: entry.capability,
    operationType: entry.operationType,
    unitType: entry.unitType,
    providerCostMicroUsd,
    effectiveDate: entry.pricingEffectiveDate,
    reviewBefore: entry.pricingReviewBefore,
    verificationStatus: entry.verificationStatus,
    source: entry.resolvedPricingSource || entry.pricingSourceUrl || entry.pricingSource
  });
}

function resolveLegacyGenerationCostEntry(provider, capability, options = {}) {
  const value = options.value || registry;
  const matches = findCostEntries({ provider, capability }, value)
    .filter(entry => entry.legacyGenerationDefault === true);

  if (matches.length === 0) throw registryError('unknown_cost_entry');
  if (matches.length > 1) throw registryError('ambiguous_cost_entry');

  const entry = matches[0];
  return resolveCostEntry({
    provider: entry.provider,
    modelToolId: entry.modelToolId,
    capability: entry.capability,
    operationType: entry.operationType
  }, options);
}

module.exports = {
  UNIT_TYPES,
  registry,
  validateRegistry,
  findCostEntries,
  findCostEntry,
  resolveCostEntry,
  resolveCostQuote,
  resolveLegacyGenerationCostEntry,
  estimateProviderCostMicroUsd
};

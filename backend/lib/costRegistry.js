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
  'queued_job_seconds'
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
  'enabledState'
];

function registryError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateRegistry(value = registry) {
  if (!value || typeof value.version !== 'string') {
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

    integer(entry.unitScale, `${entry.id}_unit_scale`, {
      allowZero: false
    });
  }

  return value;
}

function findCostEntry(query, value = registry) {
  validateRegistry(value);

  return value.entries.find(entry =>
    entry.provider === query.provider &&
    entry.modelToolId === query.modelToolId &&
    entry.capability === query.capability &&
    entry.operationType === query.operationType
  ) || null;
}

function resolveCostEntry(query, { env = process.env } = {}) {
  const entry = findCostEntry(query);

  if (!entry) {
    throw registryError('unknown_cost_entry');
  }

  if (entry.enabledState === 'blocked') {
    throw registryError('cost_entry_blocked');
  }

  if (
    ![
      'verified',
      'conditional_repository_verified'
    ].includes(entry.verificationStatus)
  ) {
    throw registryError('cost_entry_unverified');
  }

  if (entry.enabledState === 'conditional') {
    const requirement = entry.requiredEnvironment;

    if (
      !requirement ||
      env[requirement.name] !== requirement.value
    ) {
      throw registryError('cost_entry_condition_not_met');
    }
  }

  return Object.freeze({ ...entry });
}

function optionalMoney(value, name) {
  return value === null || value === undefined
    ? null
    : integer(value, name);
}

function estimateProviderCostMicroUsd(entry, usage = {}) {
  const unitScale = integer(
    entry.unitScale,
    'unit_scale',
    { allowZero: false }
  );
  const fixedPrice = optionalMoney(
    entry.fixedOperationPriceMicroUsd,
    'fixed_operation_price_micro_usd'
  );
  const minimum = optionalMoney(
    entry.minimumBillableMicroUsd,
    'minimum_billable_micro_usd'
  );
  const inputPrice = optionalMoney(
    entry.inputUnitPriceMicroUsd,
    'input_unit_price_micro_usd'
  );
  const outputPrice = optionalMoney(
    entry.outputUnitPriceMicroUsd,
    'output_unit_price_micro_usd'
  );
  const cachedPrice = optionalMoney(
    entry.cachedUnitPriceMicroUsd,
    'cached_unit_price_micro_usd'
  );

  if (
    fixedPrice === null &&
    inputPrice === null &&
    outputPrice === null
  ) {
    throw financialError('price_measurement_unavailable');
  }

  let total = fixedPrice || 0n;
  const inputUnits = integer(
    usage.inputUnits ?? usage.input_tokens ?? usage.prompt_tokens ?? 0,
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

  if (inputUnits > 0n && inputPrice === null) {
    throw financialError('input_price_unavailable');
  }

  if (outputUnits > 0n && outputPrice === null) {
    throw financialError('output_price_unavailable');
  }

  if (cachedUnits > 0n && cachedPrice === null) {
    throw financialError('cached_price_unavailable');
  }

  total += ceilDiv(inputUnits * (inputPrice || 0n), unitScale);
  total += ceilDiv(outputUnits * (outputPrice || 0n), unitScale);
  total += ceilDiv(cachedUnits * (cachedPrice || 0n), unitScale);

  if (minimum !== null && total < minimum) {
    total = minimum;
  }

  return total.toString();
}

module.exports = {
  UNIT_TYPES,
  registry,
  validateRegistry,
  findCostEntry,
  resolveCostEntry,
  estimateProviderCostMicroUsd
};

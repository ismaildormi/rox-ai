'use strict';

const config = require('../config/final-product.v1.json');

function validateFinalProductConfig(value = config) {
  if (value.schemaVersion !== 1 || value.pack !== 10) throw new Error('invalid_final_product_config');
  const ids = Object.keys(value.interfaces || {});
  if (JSON.stringify(ids) !== JSON.stringify(value.interfaceOrder)) throw new Error('invalid_interface_order');
  if (new Set(value.interfaceOrder).size !== value.interfaceOrder.length) throw new Error('duplicate_interface');
  if (!Array.isArray(value.requiredUxStates) || value.requiredUxStates.length !== 8) throw new Error('invalid_ux_states');
  if (Object.values(value.activation).some(Boolean)) throw new Error('unsafe_final_product_activation');
  return value;
}

function publicReadinessInventory() {
  const value = validateFinalProductConfig();
  return {
    schemaVersion: value.schemaVersion,
    mode: value.mode,
    interfaceOrder: [...value.interfaceOrder],
    interfaces: Object.fromEntries(Object.entries(value.interfaces).map(([id, item]) => [id, { status: item.status, productionVerified: item.productionVerified }])),
    requiredUxStates: [...value.requiredUxStates],
    supportedLocalesForValidation: [...value.supportedLocalesForValidation],
    platforms: JSON.parse(JSON.stringify(value.platforms)),
    activation: { ...value.activation }
  };
}

module.exports = { config, validateFinalProductConfig, publicReadinessInventory };

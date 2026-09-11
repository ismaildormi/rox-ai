'use strict';

const crypto = require('crypto');

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function constantTimeEqual(provided, expected) {
  if (!nonEmpty(provided) || !nonEmpty(expected)) return false;

  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function createHeaderSecretGuard({
  envName,
  headerName,
  disabledCode = 'operator_endpoint_disabled',
}) {
  if (!nonEmpty(envName) || !nonEmpty(headerName)) {
    throw new Error('operator auth requires envName and headerName');
  }

  const normalizedHeader = headerName.toLowerCase();

  return function requireOperatorSecret(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');

    const expected = process.env[envName];
    if (!nonEmpty(expected)) {
      return res.status(503).json({
        status: 'error',
        code: disabledCode,
        message: 'Endpoint unavailable.',
      });
    }

    const provided = req.headers?.[normalizedHeader];
    if (!constantTimeEqual(provided, expected)) {
      return res.status(401).json({
        status: 'error',
        code: 'unauthorized',
        message: 'Unauthorized.',
      });
    }

    return next();
  };
}

module.exports = {
  constantTimeEqual,
  createHeaderSecretGuard,
};

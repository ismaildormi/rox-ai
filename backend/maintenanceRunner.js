'use strict';

const crypto = require('crypto');

function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

async function main() {
  const target = required('MAINTENANCE_TARGET_URL').replace(/\/+$/, '');
  const secret = required('CRON_SECRET');
  const schedulerRunId = crypto.randomUUID();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await fetch(`${target}/internal/maintenance/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': secret,
        'x-maintenance-scheduler-run-id': schedulerRunId,
      },
      body: JSON.stringify({ source: 'railway-cron' }),
      signal: controller.signal,
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 500) };
    }

    const summary = {
      schedulerRunId,
      httpStatus: response.status,
      status: body?.status || body?.code || 'unknown',
      maintenanceRunId: body?.receipt?.runId || null,
      duplicate: Boolean(body?.duplicate),
    };

    if (!response.ok) {
      console.error('[maintenance-runner] failed', JSON.stringify(summary));
      process.exitCode = 1;
      return;
    }

    console.log('[maintenance-runner] success', JSON.stringify(summary));
  } finally {
    clearTimeout(timeout);
  }
}

main().catch(error => {
  console.error(
    '[maintenance-runner] fatal',
    JSON.stringify({ message: String(error.message || error).slice(0, 500) })
  );
  process.exitCode = 1;
});

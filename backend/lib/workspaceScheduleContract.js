'use strict';

const { config } = require('./workspaceCapabilityRegistry');
const { object, text, uuid, fail } = require('./workspaceValidation');

function normalizeSchedule(input, { now = Date.now() } = {}) {
  const value = object(input, 'invalid_workspace_schedule');
  if (!['once', 'recurring'].includes(value.type)) fail('invalid_workspace_schedule_type');
  const runAt = new Date(value.runAt);
  if (!Number.isFinite(runAt.getTime()) || runAt.getTime() <= now) fail('invalid_workspace_schedule_time');
  const horizon = config.security.maximumScheduleHorizonDays * 86400000;
  if (runAt.getTime() - now > horizon) fail('workspace_schedule_horizon_exceeded');
  const intervalMinutes = value.type === 'recurring' ? Number(value.intervalMinutes) : null;
  if (value.type === 'recurring' && (!Number.isInteger(intervalMinutes) || intervalMinutes < config.security.minimumScheduleIntervalMinutes || intervalMinutes > 525600)) fail('invalid_workspace_schedule_interval');
  return {
    workflowId: uuid(value.workflowId, 'invalid_workspace_schedule_workflow_id'),
    title: text(value.title, { code: 'invalid_workspace_schedule_title', max: config.limits.scheduleTitleChars }),
    type: value.type,
    runAt: runAt.toISOString(),
    intervalMinutes,
    timezone: text(value.timezone, { code: 'invalid_workspace_schedule_timezone', max: 64 }),
    notificationsEnabled: value.notificationsEnabled === true,
    executionEnabled: false,
    state: 'draft'
  };
}

module.exports = { normalizeSchedule };

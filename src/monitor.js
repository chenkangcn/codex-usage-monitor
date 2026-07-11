import path from 'node:path';
import { findLatestRateLimit } from './events.js';
import { readInternalState, writeJsonAtomic } from './state.js';

export function classifyUsage(usedPercent, config) {
  if (usedPercent > config.criticalThreshold) return 'critical';
  if (usedPercent > config.severeThreshold) return 'severe';
  return 'ok';
}

export function notificationDecision(previous, event, alertStepPercent) {
  const key = event.resetsAt.toISOString();
  const milestones = previous.windowKey === key && Array.isArray(previous.notifiedMilestones)
    ? previous.notifiedMilestones
    : [];
  const milestone = Math.min(100, Math.floor(event.usedPercent / alertStepPercent) * alertStepPercent);
  if (milestone < alertStepPercent || milestones.includes(milestone)) {
    return { notify: false, milestone: null, notifiedMilestones: milestones };
  }
  return {
    notify: true,
    milestone,
    notifiedMilestones: [...milestones, milestone].sort((a, b) => a - b),
  };
}

function publicState(event, status, now) {
  return {
    status,
    usedPercent: event ? event.usedPercent : null,
    remainingPercent: event ? Math.max(0, 100 - event.usedPercent) : null,
    windowMinutes: event ? event.windowMinutes : null,
    resetsAt: event ? event.resetsAt.toISOString() : null,
    lastCheckedAt: now.toISOString(),
    sourceUpdatedAt: event ? event.sourceUpdatedAt.toISOString() : null,
  };
}

export async function runMonitor(config, dependencies = {}) {
  const now = dependencies.now ?? new Date();
  const locate = dependencies.findLatestRateLimit ?? findLatestRateLimit;
  const notify = dependencies.notify ?? (async () => {});
  const statePath = path.join(config.dataDir, 'state.json');
  const internalPath = path.join(config.dataDir, '.notification-state.json');
  const event = await locate(config.sessionDirs, { targetWindowMinutes: config.targetWindowMinutes });

  if (!event || event.resetsAt <= now) {
    const state = publicState(null, 'no_data', now);
    await writeJsonAtomic(statePath, state);
    await writeJsonAtomic(internalPath, {});
    return state;
  }

  const status = classifyUsage(event.usedPercent, config);
  const previous = await readInternalState(internalPath);
  const decision = notificationDecision(previous, event, config.alertStepPercent);
  const state = publicState(event, status, now);
  await writeJsonAtomic(statePath, state);
  if (decision.notify) await notify(status, event, decision.milestone);
  await writeJsonAtomic(internalPath, {
    windowKey: event.resetsAt.toISOString(),
    notifiedMilestones: decision.notifiedMilestones,
  });
  return state;
}

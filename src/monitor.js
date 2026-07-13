import path from 'node:path';
import { findLatestRateLimits } from './events.js';
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

const windows = [
  { kind: 'fiveHour', minutes: 300 },
  { kind: 'weekly', minutes: 10080 },
];

function windowPublicState(event, config) {
  const status = event ? classifyUsage(event.usedPercent, config) : 'no_data';
  return {
    status,
    usedPercent: event ? event.usedPercent : null,
    remainingPercent: event ? Math.max(0, 100 - event.usedPercent) : null,
    windowMinutes: event ? event.windowMinutes : null,
    resetsAt: event ? event.resetsAt.toISOString() : null,
    sourceUpdatedAt: event ? event.sourceUpdatedAt.toISOString() : null,
  };
}

function publicState(limits, config, now) {
  const fiveHour = windowPublicState(limits[300] ?? null, config);
  const weekly = windowPublicState(limits[10080] ?? null, config);
  const ranks = { no_data: 0, ok: 1, severe: 2, critical: 3 };
  const status = ranks[weekly.status] > ranks[fiveHour.status] ? weekly.status : fiveHour.status;
  const updatedDates = [fiveHour.sourceUpdatedAt, weekly.sourceUpdatedAt].filter(Boolean).sort();
  return {
    status,
    usedPercent: fiveHour.usedPercent,
    remainingPercent: fiveHour.remainingPercent,
    windowMinutes: fiveHour.windowMinutes,
    resetsAt: fiveHour.resetsAt,
    lastCheckedAt: now.toISOString(),
    sourceUpdatedAt: updatedDates.at(-1) ?? null,
    fiveHour,
    weekly,
  };
}

export async function runMonitor(config, dependencies = {}) {
  const now = dependencies.now ?? new Date();
  const locate = dependencies.findLatestRateLimits ?? findLatestRateLimits;
  const notify = dependencies.notify ?? (async () => {});
  const statePath = path.join(config.dataDir, 'state.json');
  const internalPath = path.join(config.dataDir, '.notification-state.json');
  const located = await locate(config.sessionDirs, { windowMinutes: [300, 10080], now });
  const limits = Object.fromEntries(
    Object.entries(located).filter(([, event]) => event?.resetsAt > now),
  );
  const state = publicState(limits, config, now);
  await writeJsonAtomic(statePath, state);
  const previous = await readInternalState(internalPath);
  const next = { windows: {} };
  const pending = [];

  for (const definition of windows) {
    const event = limits[definition.minutes];
    if (!event) continue;
    const priorWindow = previous.windows?.[definition.kind]
      ?? (definition.kind === 'fiveHour' ? previous : {});
    const decision = notificationDecision(priorWindow, event, config.alertStepPercent);
    next.windows[definition.kind] = {
      windowKey: event.resetsAt.toISOString(),
      notifiedMilestones: decision.notify
        ? priorWindow.windowKey === event.resetsAt.toISOString()
          ? (priorWindow.notifiedMilestones ?? [])
          : []
        : decision.notifiedMilestones,
    };
    if (decision.notify) pending.push({ definition, event, decision });
  }
  for (const { definition, event, decision } of pending) {
    const status = classifyUsage(event.usedPercent, config);
    await notify(status, event, decision.milestone, definition.kind);
    next.windows[definition.kind].notifiedMilestones = decision.notifiedMilestones;
    await writeJsonAtomic(internalPath, next);
  }
  await writeJsonAtomic(internalPath, next);
  return state;
}

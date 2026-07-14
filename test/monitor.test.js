import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyUsage, notificationDecision, runMonitor } from '../src/monitor.js';

const thresholds = { alertStepPercent: 10, severeThreshold: 80, criticalThreshold: 90 };

function event(usedPercent, reset = '2026-07-11T10:00:00Z', windowMinutes = 300) {
  return {
    usedPercent,
    windowMinutes,
    resetsAt: new Date(reset),
    eventAt: new Date('2026-07-11T05:00:00Z'),
    sourceUpdatedAt: new Date('2026-07-11T05:00:00Z'),
  };
}

test('classifies severe and critical levels at inclusive remaining-allowance boundaries', () => {
  assert.equal(classifyUsage(79.9, thresholds), 'ok');
  assert.equal(classifyUsage(80, thresholds), 'severe');
  assert.equal(classifyUsage(80.1, thresholds), 'severe');
  assert.equal(classifyUsage(89.9, thresholds), 'severe');
  assert.equal(classifyUsage(90, thresholds), 'critical');
  assert.equal(classifyUsage(90.1, thresholds), 'critical');
});

test('notifies once at every observed 10 percent milestone', () => {
  const first = notificationDecision({}, event(12), 10);
  assert.equal(first.notify, true);
  assert.equal(first.milestone, 10);
  const repeated = notificationDecision({ windowKey: event(12).resetsAt.toISOString(), notifiedMilestones: first.notifiedMilestones }, event(19), 10);
  assert.equal(repeated.notify, false);
  const next = notificationDecision({ windowKey: event(12).resetsAt.toISOString(), notifiedMilestones: first.notifiedMilestones }, event(20), 10);
  assert.equal(next.notify, true);
  assert.equal(next.milestone, 20);
});

test('a jump across milestones sends only the current highest milestone', () => {
  const decision = notificationDecision({}, event(37), 10);
  assert.equal(decision.milestone, 30);
  assert.deepEqual(decision.notifiedMilestones, [30]);
});

test('a new reset window can notify again', () => {
  const previous = { windowKey: '2026-07-11T10:00:00.000Z', notifiedMilestones: [80] };
  assert.equal(notificationDecision(previous, event(82, '2026-07-11T15:00:00Z'), 10).notify, true);
});

test('expired windows produce no_data and no notification', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-monitor-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let notifications = 0;
  const config = { ...thresholds, dataDir, sessionDirs: [], targetWindowMinutes: 300 };
  const state = await runMonitor(config, {
    now: new Date('2026-07-11T11:00:00Z'),
    findLatestRateLimits: async () => ({ 300: event(99, '2026-07-11T10:00:00Z') }),
    notify: async () => { notifications += 1; },
  });
  assert.equal(state.status, 'no_data');
  assert.equal(state.usedPercent, null);
  assert.equal(state.fiveHour.status, 'no_data');
  assert.equal(state.weekly.status, 'no_data');
  assert.equal(notifications, 0);
});

test('runMonitor persists both windows and deduplicates them independently', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-monitor-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const notifications = [];
  const config = { ...thresholds, dataDir, sessionDirs: [], targetWindowMinutes: 300 };
  const dependencies = {
    now: new Date('2026-07-11T06:00:00Z'),
    findLatestRateLimits: async () => ({
      300: event(82),
      10080: event(34, '2026-07-18T10:00:00Z', 10080),
    }),
    notify: async (status, value, milestone, kind) => {
      notifications.push({ status, milestone, kind });
    },
  };
  await runMonitor(config, dependencies);
  await runMonitor(config, dependencies);
  const state = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'), 'utf8'));
  assert.deepEqual(notifications, [
    { status: 'severe', milestone: 80, kind: 'fiveHour' },
    { status: 'ok', milestone: 30, kind: 'weekly' },
  ]);
  assert.deepEqual(Object.keys(state), [
    'status', 'usedPercent', 'remainingPercent', 'windowMinutes',
    'resetsAt', 'lastCheckedAt', 'sourceUpdatedAt', 'fiveHour', 'weekly',
  ]);
  assert.equal(state.fiveHour.usedPercent, 82);
  assert.equal(state.weekly.usedPercent, 34);
});

test('weekly status remains useful when the five-hour window is absent', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-monitor-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const config = { ...thresholds, dataDir, sessionDirs: [], targetWindowMinutes: 300 };
  const state = await runMonitor(config, {
    now: new Date('2026-07-11T06:00:00Z'),
    findLatestRateLimits: async () => ({
      10080: event(91, '2026-07-18T10:00:00Z', 10080),
    }),
    notify: async () => {},
  });
  assert.equal(state.status, 'critical');
  assert.equal(state.usedPercent, null);
  assert.equal(state.fiveHour.status, 'no_data');
  assert.equal(state.weekly.status, 'critical');
});

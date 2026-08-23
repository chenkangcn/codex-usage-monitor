import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findLatestRateLimits, parseRateLimitLine } from '../src/events.js';

function limit(usedPercent, windowMinutes, resetsAt) {
  return { used_percent: usedPercent, window_minutes: windowMinutes, resets_at: resetsAt };
}

function tokenEvent(timestamp, primary, secondary = null) {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: { input_tokens: 123 } },
      rate_limits: { primary, secondary },
    },
  });
}

function sessionEvent(timestamp) {
  return JSON.stringify({ timestamp, type: 'session_meta', payload: {} });
}

test('parses both primary and secondary by window length and tolerates damaged JSON', () => {
  assert.equal(parseRateLimitLine('{bad json with rate_limits'), null);
  assert.equal(parseRateLimitLine(JSON.stringify({ type: 'event_msg', payload: { type: 'message', rate_limits: {} } })), null);
  const parsed = parseRateLimitLine(tokenEvent(
    '2026-07-11T01:00:00Z',
    limit(80, 300, '2026-07-11T06:00:00Z'),
    limit(30, 10080, '2026-07-18T01:00:00Z'),
  ));
  assert.deepEqual(parsed.limits.map((item) => item.windowMinutes), [300, 10080]);
  assert.deepEqual(parsed.limits.map((item) => item.usedPercent), [80, 30]);
});

test('recognizes the current weekly-only shape when primary is 10080 minutes', () => {
  const parsed = parseRateLimitLine(tokenEvent(
    '2026-07-13T02:56:37Z',
    limit(7, 10080, '2026-07-19T18:53:18Z'),
  ));
  assert.equal(parsed.limits.length, 1);
  assert.equal(parsed.limits[0].windowMinutes, 10080);
  assert.equal(parsed.limits[0].usedPercent, 7);
});

test('selects latest valid five-hour and weekly events across sessions and archives', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-events-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const active = path.join(root, 'sessions');
  const archived = path.join(root, 'archived_sessions');
  await fs.mkdir(active);
  await fs.mkdir(archived);
  await fs.writeFile(path.join(active, 'a.jsonl'), [
    tokenEvent('2026-07-11T01:00:00Z', limit(70, 300, '2026-07-11T06:00:00Z')),
    '{broken rate_limits',
    tokenEvent('2026-07-11T03:00:00Z', limit(31, 10080, '2026-07-18T03:00:00Z')),
  ].join('\n'));
  await fs.writeFile(path.join(archived, 'b.jsonl'), [
    tokenEvent('2026-07-11T02:00:00Z', limit(85, 300, '2026-07-11T07:00:00Z')),
    tokenEvent('2026-07-11T04:00:00Z', limit(92, 300, '2026-07-11T09:00:00Z')),
  ].join('\n'));
  const future = new Date('2026-07-11T04:01:00Z');
  await Promise.all([
    fs.utimes(path.join(active, 'a.jsonl'), future, future),
    fs.utimes(path.join(archived, 'b.jsonl'), future, future),
  ]);

  const latest = await findLatestRateLimits([active, archived], {
    now: new Date('2026-07-11T04:30:00Z'),
  });
  assert.equal(latest[300].usedPercent, 92);
  assert.equal(latest[300].eventAt.toISOString(), '2026-07-11T04:00:00.000Z');
  assert.equal(latest[10080].usedPercent, 31);
  assert.equal(latest[10080].eventAt.toISOString(), '2026-07-11T03:00:00.000Z');
});

test('drops expired windows without failing the other window', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-events-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'one.jsonl'), tokenEvent(
    '2026-07-11T04:00:00Z',
    limit(90, 300, '2026-07-11T04:15:00Z'),
    limit(40, 10080, '2026-07-18T04:00:00Z'),
  ));
  const fileTime = new Date('2026-07-11T04:01:00Z');
  await fs.utimes(path.join(root, 'one.jsonl'), fileTime, fileTime);
  const latest = await findLatestRateLimits([root], { now: new Date('2026-07-11T04:30:00Z') });
  assert.equal(latest[300], undefined);
  assert.equal(latest[10080].usedPercent, 40);
});

test('prefers a newer session even when an older session writes later', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-events-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const current = path.join(root, 'current.jsonl');
  const stale = path.join(root, 'stale.jsonl');
  await fs.writeFile(stale, [
    sessionEvent('2026-07-29T21:00:00Z'),
    tokenEvent(
      '2026-07-29T22:34:00Z',
      limit(100, 10080, '2026-08-05T04:18:27Z'),
    ),
  ].join('\n'));
  await fs.writeFile(current, [
    sessionEvent('2026-07-29T22:29:59Z'),
    tokenEvent(
      '2026-07-29T22:30:00Z',
      limit(1, 10080, '2026-08-05T22:30:00Z'),
    ),
  ].join('\n'));
  await fs.utimes(current, new Date('2026-07-29T22:30:01Z'), new Date('2026-07-29T22:30:01Z'));
  await fs.utimes(stale, new Date('2026-07-29T22:34:01Z'), new Date('2026-07-29T22:34:01Z'));

  const latest = await findLatestRateLimits([root], {
    now: new Date('2026-07-29T22:35:00Z'),
  });
  assert.equal(latest[10080].usedPercent, 1);
  assert.equal(latest[10080].resetsAt.toISOString(), '2026-08-05T22:30:00.000Z');
});

test('newer session wins when its reset boundary is earlier', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-events-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stale = path.join(root, 'stale.jsonl');
  const current = path.join(root, 'current.jsonl');
  await fs.writeFile(stale, [
    sessionEvent('2026-07-30T04:00:00Z'),
    tokenEvent(
      '2026-07-30T04:14:00Z',
      limit(38, 10080, '2026-08-05T22:30:00Z'),
    ),
  ].join('\n'));
  await fs.writeFile(current, [
    sessionEvent('2026-07-30T05:25:59Z'),
    tokenEvent(
      '2026-07-30T05:26:00Z',
      limit(55, 10080, '2026-08-05T05:14:15Z'),
    ),
  ].join('\n'));
  const currentTime = new Date('2026-07-30T05:26:01Z');
  await fs.utimes(stale, new Date('2026-07-30T05:27:00Z'), new Date('2026-07-30T05:27:00Z'));
  await fs.utimes(current, currentTime, currentTime);

  const latest = await findLatestRateLimits([root], {
    now: new Date('2026-07-30T05:28:00Z'),
  });
  assert.equal(latest[10080].usedPercent, 55);
  assert.equal(latest[10080].resetsAt.toISOString(), '2026-08-05T05:14:15.000Z');
});

test('uses event time when reset timestamps only drift by a few minutes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-events-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'one.jsonl'), [
    tokenEvent('2026-07-29T22:30:00Z', limit(1, 10080, '2026-08-05T22:33:00Z')),
    tokenEvent('2026-07-29T22:31:00Z', limit(2, 10080, '2026-08-05T22:30:00Z')),
  ].join('\n'));
  const fileTime = new Date('2026-07-29T22:31:01Z');
  await fs.utimes(path.join(root, 'one.jsonl'), fileTime, fileTime);

  const latest = await findLatestRateLimits([root], {
    now: new Date('2026-07-29T22:32:00Z'),
  });
  assert.equal(latest[10080].usedPercent, 2);
});

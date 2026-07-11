import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findLatestRateLimit, parseRateLimitLine } from '../src/events.js';

function tokenEvent(timestamp, used, resetsAt, windowMinutes = 300) {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: { input_tokens: 123 } },
      rate_limits: { primary: { used_percent: used, window_minutes: windowMinutes, resets_at: resetsAt } },
    },
  });
}

test('parses only token_count rate limit events and tolerates damaged JSON', () => {
  assert.equal(parseRateLimitLine('{bad json with rate_limits'), null);
  assert.equal(parseRateLimitLine(JSON.stringify({ type: 'event_msg', payload: { type: 'message', rate_limits: {} } })), null);
  const parsed = parseRateLimitLine(tokenEvent('2026-07-11T01:00:00Z', 80, 1783735200));
  assert.equal(parsed.usedPercent, 80);
  assert.equal(parsed.windowMinutes, 300);
});

test('selects latest valid five-hour event across sessions and archives', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-events-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const active = path.join(root, 'sessions');
  const archived = path.join(root, 'archived_sessions');
  await fs.mkdir(active);
  await fs.mkdir(archived);
  await fs.writeFile(path.join(active, 'a.jsonl'), [
    tokenEvent('2026-07-11T01:00:00Z', 70, 1783735200),
    '{broken rate_limits',
    tokenEvent('2026-07-11T03:00:00Z', 81, 1783742400, 10080),
  ].join('\n'));
  await fs.writeFile(path.join(archived, 'b.jsonl'), [
    tokenEvent('2026-07-11T02:00:00Z', 85, 1783738800),
    tokenEvent('2026-07-11T04:00:00Z', 92, 1783746000),
  ].join('\n'));
  const future = new Date('2026-07-11T04:01:00Z');
  await Promise.all([
    fs.utimes(path.join(active, 'a.jsonl'), future, future),
    fs.utimes(path.join(archived, 'b.jsonl'), future, future),
  ]);

  const latest = await findLatestRateLimit([active, archived]);
  assert.equal(latest.usedPercent, 92);
  assert.equal(latest.eventAt.toISOString(), '2026-07-11T04:00:00.000Z');
});

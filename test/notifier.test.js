import assert from 'node:assert/strict';
import test from 'node:test';
import { alertPresentation, isChineseLanguage } from '../src/notifier.js';

function event(usedPercent) {
  return {
    usedPercent,
    resetsAt: new Date('2026-07-11T22:59:00Z'),
  };
}

test('ordinary milestone bubble lasts five seconds', () => {
  const presentation = alertPresentation('ok', event(50), 50);
  assert.equal(presentation.durationSeconds, 5);
  assert.match(presentation.zh.title, /用量提醒/);
  assert.match(presentation.en.title, /Five-Hour Usage/);
});

test('severe bubble lasts twenty seconds', () => {
  const presentation = alertPresentation('severe', event(81), 80);
  assert.equal(presentation.durationSeconds, 20);
  assert.match(presentation.zh.title, /严重不足/);
  assert.match(presentation.en.title, /Allowance Low/);
});

test('critical bubble requires manual dismissal', () => {
  const presentation = alertPresentation('critical', event(91), 90);
  assert.equal(presentation.durationSeconds, 0);
  assert.match(presentation.zh.title, /紧急警告/);
  assert.match(presentation.en.title, /Allowance Critical/);
});

test('detects every Chinese locale variant and defaults others to English', () => {
  assert.equal(isChineseLanguage('zh-CN'), true);
  assert.equal(isChineseLanguage('zh-Hant-TW'), true);
  assert.equal(isChineseLanguage('en-US'), false);
  assert.equal(isChineseLanguage('ja-JP'), false);
});

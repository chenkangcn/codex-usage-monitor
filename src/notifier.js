import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function alertPresentation(level, event, milestone) {
  const remaining = Math.max(0, 100 - event.usedPercent);
  const titleZh = level === 'critical'
    ? 'Codex 五小时额度紧急警告'
    : level === 'severe'
      ? 'Codex 五小时额度严重不足'
      : 'Codex 五小时用量提醒';
  const titleEn = level === 'critical'
    ? 'Codex Five-Hour Allowance Critical'
    : level === 'severe'
      ? 'Codex Five-Hour Allowance Low'
      : 'Codex Five-Hour Usage';
  const used = event.usedPercent.toFixed(1);
  const remainingText = remaining.toFixed(1);
  const messageZh = `本窗口已使用 ${used}%（跨过 ${milestone}%），剩余约 ${remainingText}%，将在 ${event.resetsAt.toLocaleString('zh-CN')} 重置。`;
  const messageEn = `Five-hour usage is ${used}% (crossed ${milestone}%), about ${remainingText}% remains, and the window resets at ${event.resetsAt.toLocaleString('en-US')}.`;
  const durationSeconds = level === 'critical' ? 0 : level === 'severe' ? 20 : 5;
  return {
    zh: { title: titleZh, message: messageZh },
    en: { title: titleEn, message: messageEn },
    durationSeconds,
  };
}

export function isChineseLanguage(language) {
  return /^zh(?:-|$)/i.test(language ?? '');
}

function launchAlertHelper(helperPath, level, presentation) {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, [
      '--level', level,
      '--title-zh', presentation.zh.title,
      '--message-zh', presentation.zh.message,
      '--title-en', presentation.en.title,
      '--message-en', presentation.en.message,
      '--duration', String(presentation.durationSeconds),
    ], {
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function sendLegacyNotification(presentation) {
  const language = Intl.DateTimeFormat().resolvedOptions().locale;
  const localized = isChineseLanguage(language) ? presentation.zh : presentation.en;
  const script = 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run';
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/osascript', ['-e', script, localized.title, localized.message], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let errorText = '';
    child.stderr.on('data', (chunk) => { errorText += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`notification failed: ${errorText.trim()}`)));
  });
}

export function createMacNotifier(config) {
  const helperPath = path.join(config.dataDir, 'bin', 'codex-usage-alert');
  return async (level, event, milestone) => {
    const presentation = alertPresentation(level, event, milestone);
    try {
      await fs.access(helperPath, fs.constants.X_OK);
      await launchAlertHelper(helperPath, level, presentation);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error;
      await sendLegacyNotification(presentation);
    }
  };
}

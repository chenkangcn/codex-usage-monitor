import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function alertPresentation(level, event, milestone) {
  const remaining = Math.max(0, 100 - event.usedPercent);
  const title = level === 'critical'
    ? 'Codex 五小时额度紧急警告'
    : level === 'severe'
      ? 'Codex 五小时额度严重不足'
      : 'Codex 五小时用量提醒';
  const message = `本窗口已使用 ${event.usedPercent.toFixed(1)}%（跨过 ${milestone}%），剩余约 ${remaining.toFixed(1)}%，将在 ${event.resetsAt.toLocaleString()} 重置。`;
  const durationSeconds = level === 'critical' ? 0 : level === 'severe' ? 20 : 5;
  return { title, message, durationSeconds };
}

function launchAlertHelper(helperPath, level, presentation) {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, [
      '--level', level,
      '--title', presentation.title,
      '--message', presentation.message,
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
  const script = 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run';
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/osascript', ['-e', script, presentation.title, presentation.message], {
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

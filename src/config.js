import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const home = os.homedir();

export const defaults = Object.freeze({
  alertStepPercent: 10,
  severeThreshold: 80,
  criticalThreshold: 90,
  checkIntervalSeconds: 180,
  targetWindowMinutes: 300,
  nodePath: '/opt/homebrew/opt/node@22/bin/node',
  dataDir: path.join(home, '.codex', 'usage-monitor'),
  sessionDirs: [
    path.join(home, '.codex', 'sessions'),
    path.join(home, '.codex', 'archived_sessions'),
  ],
});

export function validateConfig(config) {
  if (!Number.isInteger(config.alertStepPercent) || config.alertStepPercent < 1 || config.alertStepPercent > 100) {
    throw new Error('alertStepPercent must be an integer from 1 to 100');
  }
  for (const key of ['severeThreshold', 'criticalThreshold']) {
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 100) {
      throw new Error(`${key} must be a number from 0 to 100`);
    }
  }
  if (config.criticalThreshold < config.severeThreshold) {
    throw new Error('criticalThreshold must be greater than or equal to severeThreshold');
  }
  if (!Number.isInteger(config.checkIntervalSeconds) || config.checkIntervalSeconds < 30) {
    throw new Error('checkIntervalSeconds must be an integer of at least 30');
  }
  return config;
}

export async function loadConfig() {
  const dataDir = process.env.CODEX_USAGE_MONITOR_DATA_DIR || defaults.dataDir;
  let user = {};
  try {
    user = JSON.parse(await fs.readFile(path.join(dataDir, 'config.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`invalid config.json: ${error.message}`);
  }
  const allowed = Object.fromEntries(
    Object.entries(user).filter(([key]) => [
      'alertStepPercent', 'severeThreshold', 'criticalThreshold', 'checkIntervalSeconds',
      'targetWindowMinutes', 'nodePath', 'sessionDirs',
    ].includes(key)),
  );
  return validateConfig({ ...defaults, ...allowed, dataDir });
}

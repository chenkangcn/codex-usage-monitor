import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { installAgent, uninstallAgent, agentStatus } from './launchd.js';
import { runMonitor } from './monitor.js';
import { sendMacNotification } from './notifier.js';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return 'Usage: codex-usage-monitor <run-once|install|uninstall|status>';
}

export async function main(args) {
  const command = args[0];
  const config = await loadConfig();
  if (command === 'run-once') {
    const state = await runMonitor(config, { notify: sendMacNotification });
    if (!args.includes('--quiet')) console.log(JSON.stringify(state));
    return;
  }
  if (command === 'install') {
    const installedPath = await installAgent(config, projectDir);
    console.log(`Installed and loaded ${installedPath}`);
    return;
  }
  if (command === 'uninstall') {
    const removed = await uninstallAgent();
    console.log(removed ? 'Unloaded and removed LaunchAgent.' : 'LaunchAgent was not installed.');
    return;
  }
  if (command === 'status') {
    const agent = await agentStatus();
    let usageState = null;
    try { usageState = JSON.parse(await fs.readFile(path.join(config.dataDir, 'state.json'), 'utf8')); } catch {}
    console.log(JSON.stringify({ agent, usage: usageState }, null, 2));
    return;
  }
  throw new Error(usage());
}

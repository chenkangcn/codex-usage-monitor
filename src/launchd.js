import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const label = 'com.local.codex-usage-monitor';

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function plistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

export function renderPlist(config, projectDir) {
  const cli = path.join(projectDir, 'bin', 'codex-usage-monitor.js');
  const log = path.join(config.dataDir, 'monitor.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(config.nodePath)}</string>
    <string>${xml(cli)}</string>
    <string>run-once</string>
    <string>--quiet</string>
  </array>
  <key>StartInterval</key><integer>${config.checkIntervalSeconds}</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

function launchctl(args, tolerateFailure = false) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/launchctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || tolerateFailure) resolve({ code, stdout, stderr });
      else reject(new Error(`launchctl failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

export async function installAgent(config, projectDir) {
  await fs.access(config.nodePath, fs.constants.X_OK);
  await fs.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(path.dirname(plistPath()), { recursive: true });
  await fs.writeFile(plistPath(), renderPlist(config, projectDir), { mode: 0o644 });
  const domain = `gui/${process.getuid()}`;
  await launchctl(['bootout', domain, plistPath()], true);
  await launchctl(['bootstrap', domain, plistPath()]);
  return plistPath();
}

export async function uninstallAgent() {
  const domain = `gui/${process.getuid()}`;
  await launchctl(['bootout', domain, plistPath()], true);
  try {
    await fs.unlink(plistPath());
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function agentStatus() {
  let installed = true;
  try { await fs.access(plistPath()); } catch { installed = false; }
  const result = await launchctl(['print', `gui/${process.getuid()}/${label}`], true);
  return { installed, loaded: result.code === 0, plistPath: plistPath() };
}

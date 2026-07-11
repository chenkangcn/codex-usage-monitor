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

function runProcess(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`helper build failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

export async function buildAlertHelper(config, projectDir) {
  const swiftSource = path.join(projectDir, 'helper', 'CodexUsageAlert.swift');
  const objectiveCSource = path.join(projectDir, 'helper', 'CodexUsageAlert.m');
  const binDir = path.join(config.dataDir, 'bin');
  const moduleCache = path.join(config.dataDir, '.swift-module-cache');
  const destination = path.join(binDir, 'codex-usage-alert');
  const temporary = `${destination}.${process.pid}.tmp`;
  await fs.mkdir(binDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(moduleCache, { recursive: true, mode: 0o700 });
  try {
    await runProcess('/usr/bin/xcrun', [
      'swiftc', '-O', '-module-cache-path', moduleCache,
      '-framework', 'AppKit', swiftSource, '-o', temporary,
    ]);
  } catch {
    // Some partially updated Command Line Tools installations ship a Swift
    // compiler and SDK with different patch versions. Clang/AppKit provides
    // the same native panel without making installation brittle.
    await runProcess('/usr/bin/xcrun', [
      'clang', '-fobjc-arc', '-O2', '-framework', 'AppKit',
      objectiveCSource, '-o', temporary,
    ]);
  }
  await fs.chmod(temporary, 0o700);
  await fs.rename(temporary, destination);
  return destination;
}

export async function installAgent(config, projectDir) {
  await fs.access(config.nodePath, fs.constants.X_OK);
  await fs.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await buildAlertHelper(config, projectDir);
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

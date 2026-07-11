import fs from 'node:fs/promises';
import path from 'node:path';

function asDate(value) {
  if (typeof value === 'number') {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  return null;
}

function rateLimitsFromEvent(event) {
  const candidates = [
    event?.payload?.rate_limits,
    event?.payload?.info?.rate_limits,
    event?.info?.rate_limits,
    event?.rate_limits,
  ];
  return candidates.find((value) => value && typeof value === 'object') ?? null;
}

export function parseRateLimitLine(line, source = {}) {
  if (!line.includes('rate_limits')) return null;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (event?.type !== 'event_msg' || event?.payload?.type !== 'token_count') return null;
  const rateLimits = rateLimitsFromEvent(event);
  const primary = rateLimits?.primary;
  if (!primary || typeof primary !== 'object') return null;

  const usedPercent = Number(primary.used_percent);
  const windowMinutes = Number(primary.window_minutes);
  const resetsAt = asDate(primary.resets_at);
  if (!Number.isFinite(usedPercent) || !Number.isFinite(windowMinutes) || !resetsAt) return null;

  const eventAt = asDate(event.timestamp ?? event.created_at ?? event.time) ?? source.mtime ?? resetsAt;
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    windowMinutes,
    resetsAt,
    eventAt,
    sourceUpdatedAt: eventAt,
  };
}

async function findJsonlFiles(dir) {
  const results = [];
  async function visit(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EACCES') return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const stat = await fs.stat(fullPath);
        results.push({ path: fullPath, mtime: stat.mtime, size: stat.size });
      }
    }
  }
  await visit(dir);
  return results;
}

export async function latestRateLimitInFile(file, options = {}) {
  const chunkSize = options.chunkSize ?? 64 * 1024;
  const handle = await fs.open(file.path, 'r');
  let position = file.size;
  let suffix = '';
  try {
    while (position > 0) {
      const length = Math.min(chunkSize, position);
      position -= length;
      const buffer = Buffer.allocUnsafe(length);
      await handle.read(buffer, 0, length, position);
      const parts = (buffer.toString('utf8') + suffix).split('\n');
      suffix = parts.shift() ?? '';
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const parsed = parseRateLimitLine(parts[index], file);
        if (parsed && parsed.windowMinutes === (options.targetWindowMinutes ?? 300)) return parsed;
      }
    }
    const first = parseRateLimitLine(suffix, file);
    return first?.windowMinutes === (options.targetWindowMinutes ?? 300) ? first : null;
  } finally {
    await handle.close();
  }
}

export async function findLatestRateLimit(sessionDirs, options = {}) {
  const nested = await Promise.all(sessionDirs.map(findJsonlFiles));
  const files = nested.flat().sort((a, b) => b.mtime - a.mtime);
  let latest = null;
  for (const file of files) {
    if (latest && file.mtime <= latest.eventAt) break;
    const candidate = await latestRateLimitInFile(file, options);
    if (candidate && (!latest || candidate.eventAt > latest.eventAt)) latest = candidate;
  }
  return latest;
}

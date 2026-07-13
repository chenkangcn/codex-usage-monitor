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
  if (!rateLimits) return null;
  const eventAt = asDate(event.timestamp ?? event.created_at ?? event.time) ?? source.mtime;
  if (!eventAt) return null;

  const limits = [];
  const seenWindows = new Set();
  for (const raw of [rateLimits.primary, rateLimits.secondary]) {
    if (!raw || typeof raw !== 'object') continue;
    const usedPercent = Number(raw.used_percent);
    const windowMinutes = Number(raw.window_minutes);
    const resetsAt = asDate(raw.resets_at);
    if (!Number.isFinite(usedPercent) || !Number.isFinite(windowMinutes) || !resetsAt) continue;
    if (seenWindows.has(windowMinutes)) continue;
    seenWindows.add(windowMinutes);
    limits.push({
      usedPercent: Math.max(0, Math.min(100, usedPercent)),
      windowMinutes,
      resetsAt,
      eventAt,
      sourceUpdatedAt: eventAt,
    });
  }
  return limits.length > 0 ? { eventAt, sourceUpdatedAt: eventAt, limits } : null;
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

export async function latestRateLimitsInFile(file, options = {}) {
  const chunkSize = options.chunkSize ?? 64 * 1024;
  const targets = options.windowMinutes ?? [300, 10080];
  const targetSet = new Set(targets);
  const now = options.now ?? new Date();
  const found = {};
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
        if (!parsed) continue;
        for (const limit of parsed.limits) {
          if (targetSet.has(limit.windowMinutes) && !found[limit.windowMinutes] && limit.resetsAt > now) {
            found[limit.windowMinutes] = limit;
          }
        }
        const unresolved = targets.filter((minutes) => !found[minutes]);
        if (unresolved.length === 0) return found;
        if (unresolved.every((minutes) => parsed.eventAt <= new Date(now.valueOf() - minutes * 60_000))) {
          return found;
        }
      }
    }
    const first = parseRateLimitLine(suffix, file);
    if (first) {
      for (const limit of first.limits) {
        if (targetSet.has(limit.windowMinutes) && !found[limit.windowMinutes] && limit.resetsAt > now) {
          found[limit.windowMinutes] = limit;
        }
      }
    }
    return found;
  } finally {
    await handle.close();
  }
}

export async function findLatestRateLimits(sessionDirs, options = {}) {
  const nested = await Promise.all(sessionDirs.map(findJsonlFiles));
  const files = nested.flat().sort((a, b) => b.mtime - a.mtime);
  const targets = options.windowMinutes ?? [300, 10080];
  const now = options.now ?? new Date();
  const latest = {};
  for (const file of files) {
    const needed = targets.filter((minutes) => {
      if (file.mtime <= new Date(now.valueOf() - minutes * 60_000)) return false;
      return !latest[minutes] || file.mtime > latest[minutes].eventAt;
    });
    if (needed.length === 0) continue;
    const candidates = await latestRateLimitsInFile(file, { ...options, windowMinutes: needed, now });
    for (const minutes of needed) {
      const candidate = candidates[minutes];
      if (candidate && (!latest[minutes] || candidate.eventAt > latest[minutes].eventAt)) {
        latest[minutes] = candidate;
      }
    }
  }
  return latest;
}

// Backward-compatible five-hour lookup for existing local callers.
export async function findLatestRateLimit(sessionDirs, options = {}) {
  const minutes = options.targetWindowMinutes ?? 300;
  const limits = await findLatestRateLimits(sessionDirs, {
    ...options,
    windowMinutes: [minutes],
  });
  return limits[minutes] ?? null;
}

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function jobKey(job) {
  const canonicalUrl = String(job.url || '').split('#')[0].replace(/\/$/, '').toLowerCase();
  const fallback = `${job.company}|${job.title}|${job.location}`.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(canonicalUrl || fallback).digest('hex').slice(0, 32);
}

export function loadState(dataDir) {
  const file = path.join(dataDir, 'state.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { version: 1, notified: parsed.notified || {} };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { version: 1, notified: {} };
  }
}

export function saveState(dataDir, state) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'state.json');
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}


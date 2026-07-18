import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const STATE_SCHEMA_VERSION = 2;

export function canonicalJobUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|source$|src$|ref|refid|tracking|gh_src|lever-source|domain$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  } catch {
    return '';
  }
}

function inferredJobId(job) {
  if (job.jobId) return String(job.jobId).trim();
  const url = canonicalJobUrl(job.url);
  if (!url) return '';
  const pathname = new URL(url).pathname;
  return pathname.match(/(?:job|jobs|requisition|positions?|postings?)[\/-](?:[^/]*[\/-])?([A-Z]*[-_]?[0-9][A-Z0-9_-]{2,})/i)?.[1] || '';
}

export function jobKey(job) {
  const company = String(job.company || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const jobId = inferredJobId(job).toLowerCase();
  const canonicalUrl = canonicalJobUrl(job.url).toLowerCase();
  const fallback = `${job.title || ''}|${job.location || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const identity = `${company}|${jobId ? `id:${jobId}` : canonicalUrl ? `url:${canonicalUrl}` : `fallback:${fallback}`}`;
  return createHash('sha256').update(identity).digest('hex').slice(0, 40);
}

function freshState(recovery = null) {
  return { version: STATE_SCHEMA_VERSION, notified: {}, meta: { recovery } };
}

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('state root must be an object');
  if (parsed.notified != null && (typeof parsed.notified !== 'object' || Array.isArray(parsed.notified))) throw new Error('state.notified must be an object');
}

export function loadState(dataDir) {
  const file = path.join(dataDir, 'state.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    validate(parsed);
    return {
      version: STATE_SCHEMA_VERSION,
      notified: parsed.notified || {},
      meta: {
        ...(parsed.meta || {}),
        migratedFrom: parsed.version && parsed.version !== STATE_SCHEMA_VERSION ? parsed.version : undefined,
        recovery: null,
      },
    };
  } catch (error) {
    if (error.code === 'ENOENT') return freshState({ type: 'cache-miss', message: 'No prior state file was restored.' });
    fs.mkdirSync(dataDir, { recursive: true });
    const backup = path.join(dataDir, `state.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    try { fs.copyFileSync(file, backup); } catch { /* Preserve the primary error even if backup fails. */ }
    return freshState({ type: 'corrupt-state', message: error.message, backup });
  }
}

export function saveState(dataDir, state) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'state.json');
  const temp = `${file}.${process.pid}.tmp`;
  const normalized = {
    version: STATE_SCHEMA_VERSION,
    notified: state.notified || {},
    meta: { ...(state.meta || {}), savedAt: new Date().toISOString(), recovery: null },
  };
  fs.writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

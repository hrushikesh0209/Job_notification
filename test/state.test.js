import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jobKey, loadState, saveState, STATE_SCHEMA_VERSION } from '../src/state.js';

test('stable identity includes company and official job id, not title alone', () => {
  const base = { company: 'Acme', title: 'Software Engineer', location: 'India', jobId: 'REQ-7', url: 'https://jobs.example.com/REQ-7?utm_source=test' };
  assert.equal(jobKey(base), jobKey({ ...base, title: 'Renamed Software Engineer', url: 'https://jobs.example.com/REQ-7' }));
  assert.notEqual(jobKey(base), jobKey({ ...base, company: 'Other' }));
  assert.notEqual(jobKey(base), jobKey({ ...base, jobId: 'REQ-8', url: 'https://jobs.example.com/REQ-8' }));
});

test('two consecutive simulated runs suppress only successfully recorded jobs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-state-'));
  const job = { company: 'Acme', jobId: '7', title: 'Software Engineer', url: 'https://careers.acme.test/jobs/7' };
  const first = loadState(dir);
  assert.equal(first.notified[jobKey(job)], undefined);
  first.notified[jobKey(job)] = { notifiedAt: new Date().toISOString() };
  saveState(dir, first);
  const second = loadState(dir);
  assert.ok(second.notified[jobKey(job)]);
  assert.deepEqual(second.pending, {});
  assert.deepEqual(second.digestQueue, {});
  assert.deepEqual(second.portalHealth, {});
  assert.equal(second.version, STATE_SCHEMA_VERSION);
});

test('cache miss is explicit and corrupted state is backed up and recovered', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-state-'));
  assert.equal(loadState(dir).meta.recovery.type, 'cache-miss');
  fs.writeFileSync(path.join(dir, 'state.json'), '{not-json', 'utf8');
  const recovered = loadState(dir);
  assert.equal(recovered.meta.recovery.type, 'corrupt-state');
  assert.equal(fs.existsSync(recovered.meta.recovery.backup), true);
  assert.deepEqual(recovered.notified, {});
});

test('version 2 cache migration preserves notified jobs and initializes compact queues', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-state-'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    version: 2,
    notified: { existing: { notifiedAt: '2026-07-18T00:00:00Z' } },
    meta: {},
  }), 'utf8');
  const migrated = loadState(dir);
  assert.ok(migrated.notified.existing);
  assert.deepEqual(migrated.pending, {});
  assert.deepEqual(migrated.digestQueue, {});
  assert.deepEqual(migrated.portalHealth, {});
  assert.equal(migrated.meta.migratedFrom, 2);
});

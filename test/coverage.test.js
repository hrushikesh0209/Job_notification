import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeCoverage, writeCoverage } from '../src/coverage.js';

test('coverage summary preserves status, rejection, performance and artifact fields', () => {
  const rows = [
    { company: 'A', status: 'working', jobsDiscovered: 3, detailsParsed: 3, accepted: 1, rejected: 2, rejectionReasons: { LOCATION_OUTSIDE_TARGET: 2 }, durationMs: 50 },
    { company: 'B', status: 'blocked', jobsDiscovered: 0, detailsParsed: 0, accepted: 0, rejected: 0, rejectionReasons: {}, durationMs: 200 },
  ];
  const summary = summarizeCoverage(rows, { notified: 1, duplicatesSuppressed: 2 });
  assert.equal(summary.working, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.rejectionReasons.LOCATION_OUTSIDE_TARGET, 2);
  assert.equal(summary.slowestPortals[0].company, 'B');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-'));
  const output = writeCoverage(dir, rows);
  assert.equal(fs.existsSync(output.jsonPath), true);
  assert.match(fs.readFileSync(output.csvPath, 'utf8'), /rejectionReasons/);
});

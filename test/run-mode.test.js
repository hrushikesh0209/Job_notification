import test from 'node:test';
import assert from 'node:assert/strict';
import { recordPortalHealth, selectCompaniesForMode } from '../src/run-mode.js';

const companies = [
  { company: 'NVIDIA', portalUrl: 'https://nvidia.wd5.myworkdayjobs.com/External', priority: 'High', workbookRow: 2 },
  { company: 'Custom Good', portalUrl: 'https://careers.good.example/jobs', priority: 'Medium', workbookRow: 3 },
  { company: 'Browser Only', portalUrl: 'https://careers.browser.example/jobs', priority: 'High', workbookRow: 4 },
  { company: 'Unknown', portalUrl: 'https://careers.unknown.example/jobs', priority: 'Low', workbookRow: 5 },
];

test('full mode preserves every official portal', () => {
  assert.deepEqual(selectCompaniesForMode(companies, {}, { mode: 'full' }), companies);
});

test('fast mode uses direct APIs and recently learned non-browser portals', () => {
  const now = Date.parse('2026-07-18T00:00:00Z');
  const state = { portalHealth: {
    'Custom Good': { status: 'working', retrievalMethod: 'html', checkedAt: '2026-07-17T00:00:00Z', durationMs: 500 },
    'Browser Only': { status: 'working', retrievalMethod: 'browser', checkedAt: '2026-07-17T00:00:00Z', durationMs: 100 },
  } };
  const selected = selectCompaniesForMode(companies, state, { mode: 'fast', now, maxCompanies: 60 });
  assert.deepEqual(selected.map((item) => item.company), ['NVIDIA', 'Custom Good']);
});

test('recent broken health removes a seeded portal until a full scan repairs it', () => {
  const now = Date.parse('2026-07-18T00:00:00Z');
  const state = { portalHealth: { NVIDIA: { status: 'broken', retrievalMethod: 'none', checkedAt: '2026-07-17T00:00:00Z' } } };
  assert.equal(selectCompaniesForMode(companies, state, { mode: 'fast', now }).some((item) => item.company === 'NVIDIA'), false);
  recordPortalHealth(state, [{ company: 'NVIDIA', status: 'working', portalType: 'workday', retrievalMethod: 'workday-api', durationMs: 700 }], '2026-07-18T00:00:00Z');
  assert.equal(selectCompaniesForMode(companies, state, { mode: 'fast', now }).some((item) => item.company === 'NVIDIA'), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueMatches, markDelivered, notificationCandidates, pruneState, selectNotificationBatch } from '../src/notification-queue.js';

function job(key, score, priority = 'Medium') {
  return {
    key, score, priority, company: 'Acme', title: `Software Engineer ${key}`,
    location: 'Bengaluru, India', postingDate: '', experience: '2 years',
    skills: ['Java'], explanation: 'Good profile match.', url: `https://careers.acme.test/jobs/${key}`, jobId: key,
    description: 'x'.repeat(100_000),
  };
}

test('fast queue sends only high-confidence jobs while full mode retains borderline jobs', () => {
  const state = { notified: {}, pending: {} };
  enqueueMatches(state, [job('high', 85), job('borderline', 68)], '2026-07-18T00:00:00Z');
  assert.deepEqual(notificationCandidates(state, { mode: 'fast', fastMinimumScore: 75 }).map((item) => item.key), ['high']);
  assert.deepEqual(notificationCandidates(state, { mode: 'full' }).map((item) => item.key), ['high', 'borderline']);
  assert.deepEqual(selectNotificationBatch(state, { mode: 'full', limit: 1 }).map((item) => item.key), ['high']);
  assert.equal('description' in state.pending.high, false);
});

test('only delivered jobs become notified and queue retention removes stale overflow', () => {
  const state = { notified: {}, pending: {} };
  enqueueMatches(state, [job('sent', 90), job('overflow', 80)], '2026-07-01T00:00:00Z');
  markDelivered(state, [state.pending.sent], '2026-07-01T01:00:00Z');
  assert.ok(state.notified.sent);
  assert.equal(state.notified.overflow, undefined);
  assert.ok(state.pending.overflow);
  pruneState(state, { now: Date.parse('2026-07-18T00:00:00Z'), pendingDays: 14 });
  assert.equal(state.pending.overflow, undefined);
});

test('one-time replay includes a notified job once without weakening later suppression', () => {
  const replayed = job('replayed', 88);
  const state = { notified: { replayed: { notifiedAt: '2026-07-17T00:00:00Z' } }, pending: {} };
  enqueueMatches(state, [replayed], '2026-07-18T00:00:00Z');
  assert.deepEqual(state.pending, {});

  enqueueMatches(state, [replayed], '2026-07-18T00:00:00Z', { replayNotified: true });
  assert.deepEqual(notificationCandidates(state, { mode: 'full' }), []);
  assert.deepEqual(notificationCandidates(state, { mode: 'full', replayNotified: true }).map((item) => item.key), ['replayed']);

  markDelivered(state, [state.pending.replayed], '2026-07-18T01:00:00Z');
  assert.deepEqual(notificationCandidates(state, { mode: 'full' }), []);
});

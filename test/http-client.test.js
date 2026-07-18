import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient } from '../src/http-client.js';

test('HTTP client retries retryable failures with deterministic backoff', async () => {
  let attempts = 0;
  const waits = [];
  const client = createHttpClient({ requestRetries: 2, requestTimeoutMs: 1000, perDomainConcurrency: 1, retryBaseMs: 10, retryMaxMs: 100 }, {
    fetchImpl: async () => {
      attempts++;
      if (attempts < 3) return new Response('busy', { status: 503 });
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
    sleep: async (ms) => waits.push(ms),
    random: () => 0,
  });
  const result = await client.json('https://careers.example.com/jobs');
  assert.equal(result.data.ok, true);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [10, 20]);
});

test('HTTP client reports terminal timeout without leaking request data', async () => {
  const timeout = Object.assign(new Error('operation timed out'), { name: 'TimeoutError' });
  const client = createHttpClient({ requestRetries: 0, requestTimeoutMs: 10, perDomainConcurrency: 1 }, { fetchImpl: async () => { throw timeout; } });
  await assert.rejects(client.request('https://careers.example.com/jobs'), (error) => error.timeout === true && /Timeout/.test(error.message));
});

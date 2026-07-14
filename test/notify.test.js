import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { notify, reportMarkdown } from '../src/notify.js';

const job = {
  company: 'Example Corp',
  title: 'Software Engineer II - Java Backend',
  location: 'Bengaluru, India',
  postingDate: '2026-07-14',
  experience: '2-4 years',
  skills: ['Java', 'Spring Boot', 'Kafka'],
  explanation: 'The title, stack, location, and experience match the target profile.',
  score: 91,
  url: 'https://careers.example.com/jobs/123',
};

function config(reportsDir, github = {}) {
  return {
    reportsDir,
    githubActions: true,
    github: { token: '', repository: '', apiUrl: 'https://api.github.com', ...github },
    smtp: { host: '', port: 587, secure: false, user: '', pass: '', from: '', to: '' },
  };
}

test('Markdown report includes every required notification field', () => {
  const markdown = reportMarkdown([job], '14 Jul 2026, 12:00 am');
  assert.match(markdown, /Example Corp/);
  assert.match(markdown, /Software Engineer II/);
  assert.match(markdown, /Bengaluru/);
  assert.match(markdown, /2026-07-14/);
  assert.match(markdown, /2-4 years/);
  assert.match(markdown, /Java, Spring Boot, Kafka/);
  assert.match(markdown, /title, stack, location/);
  assert.match(markdown, /https:\/\/careers\.example\.com\/jobs\/123/);
});

test('GitHub Actions mode refuses to update delivery when no channel is configured', async () => {
  const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-monitor-notify-'));
  await assert.rejects(notify([job], config(reportsDir)), /No notification channel succeeded/);
});

test('GitHub Issue delivery succeeds and returns the Issue URL', async () => {
  const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-monitor-notify-'));
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ html_url: 'https://github.com/acme/jobs/issues/7' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await notify([job], config(reportsDir, { token: 'test-token', repository: 'acme/jobs' }));
    assert.equal(result.githubIssueUrl, 'https://github.com/acme/jobs/issues/7');
    assert.equal(request.url, 'https://api.github.com/repos/acme/jobs/issues');
    assert.equal(request.options.method, 'POST');
    assert.equal(JSON.parse(request.options.body).title, '[Job Monitor] 1 new relevant job');
    assert.equal(fs.existsSync(path.join(reportsDir, 'latest.html')), true);
    assert.equal(fs.existsSync(path.join(reportsDir, 'latest.md')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

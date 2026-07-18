import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, isAuthorizedJobUrl } from '../src/platform.js';

test('detects every requested ATS family from URL or page signature', () => {
  const cases = [
    ['https://acme.wd1.myworkdayjobs.com/External', '', 'workday'],
    ['https://careers.acme.com', 'boards-api.greenhouse.io/v1/boards/acme', 'greenhouse'],
    ['https://jobs.lever.co/acme', '', 'lever'],
    ['https://jobs.smartrecruiters.com/Acme', '', 'smartrecruiters'],
    ['https://acme.eightfold.ai/careers', '', 'eightfold'],
    ['https://careers.acme.com', 'career5.successfactors.eu', 'successfactors'],
    ['https://careers.oracle.com/jobs', '/hcmUI/CandidateExperience/en/sites/CX', 'oracle-recruiting'],
    ['https://acme.taleo.net/careersection', '', 'taleo'],
    ['https://careers-acme.icims.com/jobs', '', 'icims'],
    ['https://careers.acme.com', 'cdn.phenompeople.com', 'phenom'],
    ['https://careers.acme.com/jobs', '<html></html>', 'custom'],
  ];
  for (const [url, html, expected] of cases) assert.equal(detectPlatform(url, html), expected, url);
});

test('allows official and authorized ATS links but rejects aggregators', () => {
  assert.equal(isAuthorizedJobUrl('https://careers.acme.com/jobs/1', 'https://www.acme.com/careers'), true);
  assert.equal(isAuthorizedJobUrl('https://boards.greenhouse.io/acme/jobs/1', 'https://www.acme.com/careers'), true);
  assert.equal(isAuthorizedJobUrl('https://in.linkedin.com/jobs/view/1', 'https://www.acme.com/careers'), false);
  assert.equal(isAuthorizedJobUrl('https://indeed.com/viewjob?jk=1', 'https://www.acme.com/careers'), false);
});

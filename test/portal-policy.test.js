import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOfficialPortal } from '../src/portal-policy.js';

test('rejects the generic LinkedIn job-search board', () => {
  assert.equal(isAllowedOfficialPortal({
    company: 'LinkedIn',
    portalUrl: 'https://www.linkedin.com/jobs/search/',
  }), false);
});

test('allows official company and company-authorized ATS portals', () => {
  assert.equal(isAllowedOfficialPortal({
    company: 'Google',
    portalUrl: 'https://www.google.com/about/careers/applications/jobs/results/',
  }), true);
  assert.equal(isAllowedOfficialPortal({
    company: 'NVIDIA',
    portalUrl: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
  }), true);
});

test('does not reject a future company-specific LinkedIn careers URL', () => {
  assert.equal(isAllowedOfficialPortal({
    company: 'LinkedIn',
    portalUrl: 'https://careers.linkedin.com/',
  }), true);
});


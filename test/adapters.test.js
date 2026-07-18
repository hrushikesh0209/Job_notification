import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlGreenhouse, crawlLever, crawlSmartRecruiters, crawlWorkday } from '../src/adapters.js';

const baseConfig = {
  searchTerms: ['Software Engineer'],
  maxPagesPerPortal: 3,
  maxJobsPerPortal: 150,
  maxDetailJobsPerPortal: 150,
  detailConcurrency: 4,
};

test('Workday adapter paginates and parses every discovered detail', async () => {
  const offsets = [];
  const http = {
    async json(url, options = {}) {
      if (url.endsWith('/jobs')) {
        const offset = JSON.parse(options.body).offset;
        offsets.push(offset);
        const count = offset === 0 ? 20 : 1;
        return { status: 200, data: { total: 21, jobPostings: Array.from({ length: count }, (_, index) => ({
          title: 'Software Engineer II', locationsText: 'Bengaluru, India', externalPath: `/job/${offset + index + 1}`,
        })) } };
      }
      return { status: 200, data: { jobPostingInfo: { jobDescription: 'Java Spring Boot, 2 years experience' } } };
    },
  };
  const result = await crawlWorkday({ company: 'Acme', portalUrl: 'https://acme.wd1.myworkdayjobs.com/External' }, { http, config: baseConfig });
  assert.deepEqual(offsets, [0, 20]);
  assert.equal(result.jobs.length, 21);
  assert.equal(result.detailsParsed, 21);
  assert.equal(result.pagination.pagesFetched, 2);
  assert.equal(result.pagination.complete, true);
});

test('Greenhouse adapter uses the public board endpoint with embedded content', async () => {
  let requested = '';
  const http = { async json(url) {
    requested = url;
    return { status: 200, data: { jobs: [{ id: 7, title: 'Backend Software Engineer', location: { name: 'India' }, content: 'Java and Kafka', absolute_url: 'https://boards.greenhouse.io/acme/jobs/7' }] } };
  } };
  const result = await crawlGreenhouse({ company: 'Acme', portalUrl: 'https://boards.greenhouse.io/acme' }, { http, config: baseConfig, html: '' });
  assert.match(requested, /boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs/);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.detailsParsed, 1);
  assert.equal(result.pagination.totalAvailable, 1);
});

test('Lever adapter follows offset pagination', async () => {
  const skips = [];
  const http = { async json(url) {
    const skip = Number(new URL(url).searchParams.get('skip'));
    skips.push(skip);
    const count = skip === 0 ? 100 : 1;
    return { status: 200, data: Array.from({ length: count }, (_, index) => ({
      id: `id-${skip + index}`, text: 'Software Engineer I', categories: { location: 'India' }, descriptionPlain: 'Java SQL', hostedUrl: `https://jobs.lever.co/acme/id-${skip + index}`,
    })) };
  } };
  const result = await crawlLever({ company: 'Acme', portalUrl: 'https://jobs.lever.co/acme' }, { http, config: baseConfig, html: '' });
  assert.deepEqual(skips, [0, 100]);
  assert.equal(result.jobs.length, 101);
  assert.equal(result.pagination.pagesFetched, 2);
});

test('SmartRecruiters adapter paginates listings and fetches details', async () => {
  const http = { async json(url) {
    if (/postings\?/.test(url)) return { status: 200, data: { totalFound: 1, content: [{ id: 'abc', name: 'Platform Engineer', location: { city: 'Pune', country: 'India' } }] } };
    return { status: 200, data: { jobAd: { sections: { jobDescription: { text: 'Java REST APIs' }, qualifications: { text: '2 years experience' } } } } };
  } };
  const result = await crawlSmartRecruiters({ company: 'Visa', portalUrl: 'https://jobs.smartrecruiters.com/Visa' }, { http, config: baseConfig, html: '' });
  assert.equal(result.jobs.length, 1);
  assert.match(result.jobs[0].description, /Java REST APIs/);
  assert.equal(result.detailsParsed, 1);
  assert.equal(result.pagination.complete, true);
});

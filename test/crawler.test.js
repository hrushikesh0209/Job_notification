import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrawler } from '../src/crawler.js';

const config = {
  browserConcurrency: 1,
  browserTimeoutMs: 1000,
  browserSettleMs: 0,
  maxDetailJobsPerPortal: 20,
  maxJobsPerPortal: 20,
  maxGenericPages: 2,
  maxPagesPerPortal: 2,
  detailConcurrency: 2,
  userAgent: 'test',
};

const company = { company: 'Acme', portalUrl: 'https://careers.acme.com/start' };

test('generic crawler resolves relative links against the redirected URL', async () => {
  const http = { async request(url) {
    if (url.endsWith('/start')) return { status: 200, finalUrl: 'https://careers.acme.com/jobs/', text: '<a href="../jobs/123">Software Engineer II - Java</a>' };
    return { status: 200, finalUrl: url, text: '<html><body>Software Engineer II Java Spring Boot, India, 2 years experience</body></html>' };
  } };
  const crawler = await createCrawler(config, { http, browserExtract: async () => { throw new Error('browser should not run'); } });
  const result = await crawler.crawl(company);
  assert.equal(result.jobs[0].url, 'https://careers.acme.com/jobs/123');
  assert.equal(result.coverage.finalUrl, 'https://careers.acme.com/jobs/');
  assert.equal(result.coverage.status, 'working');
});

test('generic crawler repairs duplicated jobs/results relative paths', async () => {
  const google = { company: 'Google', portalUrl: 'https://www.google.com/about/careers/applications/jobs/results/' };
  const http = { async request(url) {
    if (url.includes('?q=')) return { status: 200, finalUrl: url, text: '<a href="jobs/results/123-software-engineer">Software Engineer I - Java</a>' };
    return { status: 200, finalUrl: url, text: '<body>Java, Bengaluru India</body>' };
  } };
  const crawler = await createCrawler(config, { http, browserExtract: async () => { throw new Error('browser should not run'); } });
  const result = await crawler.crawl(google);
  assert.equal(result.jobs[0].url.includes('/jobs/results/jobs/results/'), false);
  assert.match(result.jobs[0].url, /\/jobs\/results\/123-software-engineer/);
});

test('dynamic portal uses one browser fallback and records its retrieval method', async () => {
  let renders = 0;
  const http = { async request(url) {
    if (url.endsWith('/start')) return { status: 200, finalUrl: url, text: '<main id="app"></main>' };
    return { status: 200, finalUrl: url, text: '<body>Java Spring Boot, Bengaluru India, 2 years experience</body>' };
  } };
  const browserExtract = async () => {
    renders++;
    return {
      jobs: [{ company: 'Acme', title: 'Software Engineer I', location: 'Bengaluru, India', summary: 'Java', description: '', url: 'https://careers.acme.com/jobs/9', authorizedUrl: true }],
      searchLinks: [], nextLinks: [], blocked: false, html: '<a href="/jobs/9">Software Engineer I</a>', finalUrl: company.portalUrl, httpStatus: 200,
    };
  };
  const crawler = await createCrawler(config, { http, browserExtract });
  const result = await crawler.crawl(company);
  assert.equal(renders, 1);
  assert.equal(result.method, 'browser');
  assert.equal(result.jobs.length, 1);
});

test('fast mode never invokes browser rendering', async () => {
  let renders = 0;
  const http = { async request(url) { return { status: 200, finalUrl: url, text: '<main id="app"></main>' }; } };
  const crawler = await createCrawler({ ...config, browserEnabled: false }, { http, browserExtract: async () => { renders++; return {}; } });
  const result = await crawler.crawl(company);
  assert.equal(renders, 0);
  assert.equal(result.jobs.length, 0);
  assert.match(result.coverage.errors.join(' '), /Browser fallback disabled in fast mode/);
});

test('one broken portal does not poison a following successful portal', async () => {
  const good = { company: 'Good', portalUrl: 'https://careers.good.example/jobs' };
  const bad = { company: 'Bad', portalUrl: 'https://careers.bad.example/jobs' };
  const http = { async request(url) {
    if (url.includes('bad.example')) throw Object.assign(new Error('Timeout for bad portal'), { timeout: true });
    return { status: 200, finalUrl: url, text: '<script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer I","jobLocation":{"address":{"addressLocality":"Pune","addressCountry":"India"}},"description":"Java SQL, 2 years experience","url":"https://careers.good.example/jobs/1"}</script>' };
  } };
  const crawler = await createCrawler(config, { http, browserExtract: async (record) => { throw new Error(`Browser timeout for ${record.company}`); } });
  const first = await crawler.crawl(bad);
  const second = await crawler.crawl(good);
  assert.equal(first.coverage.status, 'broken');
  assert.equal(second.jobs.length, 1);
  assert.equal(second.coverage.status, 'working');
});

test('stale ATS signature falls back after adapter failure', async () => {
  const stale = { company: 'Acme', portalUrl: 'https://careers.acme.com/jobs' };
  const http = {
    async request(url) {
      if (url === stale.portalUrl) return { status: 200, finalUrl: url, text: '<script>https://api.lever.co/v0/postings/old-acme</script>' };
      return { status: 200, finalUrl: url, text: '<body>Java, Pune India</body>' };
    },
    async json() { throw Object.assign(new Error('HTTP 404 for stale Lever board'), { status: 404 }); },
  };
  const browserExtract = async () => ({
    jobs: [{ company: 'Acme', title: 'Software Engineer I', location: 'Pune, India', summary: 'Java', url: 'https://careers.acme.com/jobs/1', authorizedUrl: true }],
    searchLinks: [], nextLinks: [], blocked: false, html: '<a href="/jobs/1">Software Engineer I</a>', finalUrl: stale.portalUrl, httpStatus: 200,
  });
  const crawler = await createCrawler(config, { http, browserExtract });
  const result = await crawler.crawl(stale);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.method, 'browser');
  assert.equal(result.coverage.status, 'partially working');
  assert.match(result.coverage.errors[0], /lever adapter.*404/i);
});

test('retained HTTP 403 evidence classifies an empty rendered portal as blocked', async () => {
  const record = { company: 'Blocked', portalUrl: 'https://careers.blocked.example/jobs' };
  const http = { async request() { throw Object.assign(new Error('HTTP 403 for portal'), { status: 403 }); } };
  const browserExtract = async () => ({ jobs: [], searchLinks: [], nextLinks: [], blocked: false, html: '<main></main>', finalUrl: record.portalUrl, httpStatus: 200 });
  const crawler = await createCrawler(config, { http, browserExtract });
  const result = await crawler.crawl(record);
  assert.equal(result.coverage.status, 'blocked');
});

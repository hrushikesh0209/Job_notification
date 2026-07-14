import fs from 'node:fs';
import { load } from 'cheerio';
import { chromium } from 'playwright-core';
import { isPotentialJob } from './matcher.js';

const USER_AGENT = process.platform === 'win32'
  ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36 OfficialCareerJobMonitor/1.0'
  : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36 OfficialCareerJobMonitor/1.0';
const JOB_HREF = /(?:\/jobs?\/|jobid|job-id|job_id|jobdetail|job-detail|positions?\/|openings?\/|requisition|posting)/i;
const SEARCH_TEXT = /^(?:search\s+jobs?|view\s+(?:all\s+)?jobs?|all\s+jobs?|open\s+positions?|job\s+openings?|find\s+jobs?)$/i;
const ROLE_TEXT = /\b(?:software\s+(?:development\s+)?engineer|sde\s*[-–]?\s*(?:1|2|i|ii)\b|backend|java\s+(?:developer|engineer)|application\s+developer|platform\s+engineer)\b/i;
const LOCATION_TEXT = /\b(?:india|hyderabad|bengaluru|bangalore|chennai|pune|gurugram|gurgaon|noida|mumbai|remote)\b/i;

function clean(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(href, base) {
  try {
    const url = new URL(href, base);
    url.pathname = url.pathname.replace(/(\/jobs\/results){2,}/i, '/jobs/results');
    return url.href;
  } catch { return ''; }
}

function cleanTitle(value) {
  return clean(value).replace(/^(?:learn\s+more\s+about|view\s+(?:the\s+)?job|job\s+details?\s*[:-]?)\s+/i, '').trim();
}

function uniqueJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = `${job.url}|${job.title}`.toLowerCase();
    if (!job.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function mapLimited(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function locationFromText(text) {
  const value = clean(text);
  const match = value.match(/(?:location|locations?)\s*:?\s*([^|•\n]{2,100})/i);
  if (match && LOCATION_TEXT.test(match[1])) return clean(match[1]);
  const city = value.match(/\b(?:remote(?:\s*[-–,]\s*india)?|(?:hyderabad|bengaluru|bangalore|chennai|pune|gurugram|gurgaon|noida|mumbai)(?:,\s*[A-Za-z ]{2,30})?(?:,\s*India)?|India)\b/i);
  return clean(city?.[0] || '');
}

function dateFromText(text) {
  const value = clean(text);
  return clean(value.match(/\b(?:posted\s+)?(?:today|yesterday|\d+\s+days?\s+ago|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})\b/i)?.[0] || '');
}

function parseJobPosting(value, pageUrl, company) {
  const locationValue = value.jobLocation;
  const locations = (Array.isArray(locationValue) ? locationValue : [locationValue]).filter(Boolean).map((item) => {
    const address = item?.address || item;
    return [address?.addressLocality, address?.addressRegion, address?.addressCountry].filter(Boolean).join(', ');
  }).filter(Boolean);
  return {
    company,
    title: cleanTitle(value.title || value.name),
    location: locations.join(' / ') || clean(value.jobLocationType),
    postingDate: clean(value.datePosted),
    description: clean(value.description),
    summary: clean(value.description).slice(0, 800),
    url: absoluteUrl(value.url || pageUrl, pageUrl),
  };
}

function extractFromHtml(html, pageUrl, company) {
  const $ = load(html);
  const structured = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const parsed = JSON.parse($(element).text());
      const queue = Array.isArray(parsed) ? parsed : parsed?.['@graph'] || [parsed];
      for (const value of queue) {
        if (/JobPosting/i.test(String(value?.['@type'] || ''))) structured.push(parseJobPosting(value, pageUrl, company));
      }
    } catch { /* Some portals emit invalid or templated JSON-LD. */ }
  });
  if (structured.length) return { jobs: structured, searchLinks: [] };

  const jobs = [];
  const searchLinks = [];
  $('a[href]').each((_, element) => {
    const link = $(element);
    const href = absoluteUrl(link.attr('href'), pageUrl);
    const anchorText = clean(link.text() || link.attr('aria-label') || link.attr('title'));
    if (!href || !/^https?:/i.test(href)) return;
    if (SEARCH_TEXT.test(anchorText)) searchLinks.push(href);
    if (!JOB_HREF.test(href)) return;
    const container = link.closest('li, article, tr, [class*="job"], [class*="position"], [class*="opening"]').first();
    const summary = clean(container.length ? container.text() : link.parent().text());
    const heading = clean(container.find('h1,h2,h3,h4,[class*="title"]').first().text());
    const title = cleanTitle(anchorText && !/^(apply|view|learn more|details|read more)$/i.test(anchorText) ? anchorText : heading);
    if (!ROLE_TEXT.test(`${title} ${summary}`)) return;
    jobs.push({ company, title: title || summary.slice(0, 150), location: locationFromText(summary), postingDate: dateFromText(summary), summary, description: '', url: href });
  });
  return { jobs: uniqueJobs(jobs), searchLinks: [...new Set(searchLinks)] };
}

async function fetchText(url, timeoutMs, options = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/json' },
    ...options,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return { text: await response.text(), finalUrl: response.url, contentType: response.headers.get('content-type') || '' };
}

function workdayParts(portalUrl) {
  const url = new URL(portalUrl);
  if (!/\.myworkdayjobs\.com$/i.test(url.hostname)) return null;
  const site = url.pathname.split('/').filter(Boolean)[0];
  const tenant = url.hostname.split('.')[0];
  return site ? { origin: url.origin, site, tenant } : null;
}

function targetedPortalUrl(company) {
  const url = new URL(company.portalUrl);
  const host = url.hostname.toLowerCase();
  if (host === 'www.google.com' && url.pathname.includes('/careers/')) {
    url.searchParams.set('q', 'Software Engineer');
    url.searchParams.set('location', 'India');
  } else if (host.endsWith('amazon.jobs')) {
    url.pathname = '/en/search';
    url.searchParams.set('base_query', 'Software Engineer');
    url.searchParams.set('loc_query', 'India');
  } else if (host === 'jobs.careers.microsoft.com') {
    url.searchParams.set('q', 'Software Engineer');
    url.searchParams.set('lc', 'India');
  } else if (host === 'jobs.apple.com') {
    url.searchParams.set('search', 'Software Engineer');
    url.searchParams.set('location', 'india-INDC');
  }
  return url.href;
}

async function crawlWorkday(company, timeoutMs) {
  const parts = workdayParts(company.portalUrl);
  if (!parts) return null;
  const endpoint = `${parts.origin}/wday/cxs/${parts.tenant}/${parts.site}/jobs`;
  const postings = [];
  for (const searchText of ['Java', 'Backend Software Engineer', 'Software Engineer']) {
    const { text } = await fetchText(endpoint, timeoutMs, {
      method: 'POST',
      headers: { 'user-agent': USER_AGENT, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText }),
    });
    const result = JSON.parse(text);
    for (const item of result.jobPostings || []) {
      const externalPath = item.externalPath || '';
      postings.push({
        company: company.company,
        title: clean(item.title),
        location: clean(item.locationsText || item.location),
        postingDate: clean(item.postedOn),
        summary: clean([...(item.bulletFields || []), item.title, item.locationsText].join(' ')),
        description: '',
        url: `${parts.origin}/${parts.site}${externalPath}`,
        detailApi: `${parts.origin}/wday/cxs/${parts.tenant}/${parts.site}${externalPath}`,
      });
    }
  }

  const candidates = uniqueJobs(postings).filter(isPotentialJob).slice(0, 25);
  await mapLimited(candidates, 5, async (job) => {
    try {
      const { text } = await fetchText(job.detailApi, timeoutMs);
      const data = JSON.parse(text).jobPostingInfo || JSON.parse(text);
      job.title = clean(data.title || job.title);
      job.location = clean(data.location || data.additionalLocations?.join(' / ') || job.location);
      job.postingDate = clean(data.startDate || data.postedOn || job.postingDate);
      job.description = clean(data.jobDescription || data.description);
      job.url = absoluteUrl(data.externalUrl || job.url, job.url);
    } catch (error) {
      job.detailError = error.message;
    }
    delete job.detailApi;
  });
  return candidates;
}

function findBrowserExecutable(configured) {
  let playwrightBrowser = '';
  try { playwrightBrowser = chromium.executablePath(); } catch { /* Browser may not be installed yet. */ }
  const candidates = [
    configured,
    playwrightBrowser,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

export async function createCrawler(config) {
  let browserPromise;
  async function browser() {
    while (true) {
      const current = browserPromise;
      if (current) {
        const existing = await current.catch(() => null);
        if (browserPromise !== current) continue;
        if (existing?.isConnected()) return existing;
        browserPromise = null;
      }
      if (!browserPromise) {
        const executablePath = findBrowserExecutable(config.browserExecutable);
        if (!executablePath) throw new Error('Chromium, Chrome, or Edge was not found; install Playwright Chromium or set BROWSER_EXECUTABLE');
        browserPromise = chromium.launch({ executablePath, headless: true, args: ['--disable-gpu', '--disable-background-networking'] });
      }
      return browserPromise;
    }
  }

  async function browserExtractOnce(company, url) {
    const instance = await browser();
    let page;
    try {
      page = await instance.newPage({ userAgent: USER_AGENT, viewport: { width: 1365, height: 900 } });
      page.setDefaultTimeout(config.browserTimeoutMs);
      await page.goto(targetedPortalUrl({ ...company, portalUrl: url }), { waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs });
      await page.waitForTimeout(1_500);
      let parsed = extractFromHtml(await page.content(), page.url(), company.company);

      if (parsed.jobs.length < 3) {
        try {
          const inputs = page.locator('input:visible');
          const count = Math.min(await inputs.count(), 20);
          let keywordInput = null;
          let locationInput = null;
          for (let index = 0; index < count; index++) {
            const input = inputs.nth(index);
            const signature = `${await input.getAttribute('type') || ''} ${await input.getAttribute('name') || ''} ${await input.getAttribute('id') || ''} ${await input.getAttribute('placeholder') || ''} ${await input.getAttribute('aria-label') || ''}`;
            if (!locationInput && /location|city|country/i.test(signature)) locationInput = input;
            else if (!keywordInput && /search|keyword|query|title|job/i.test(signature)) keywordInput = input;
          }
          if (keywordInput) {
            await keywordInput.fill('Software Engineer');
            if (locationInput) await locationInput.fill('India');
            await keywordInput.press('Enter');
            await page.waitForTimeout(2_500);
            const searched = extractFromHtml(await page.content(), page.url(), company.company);
            if (searched.jobs.length) parsed = searched;
          }
        } catch { /* Search controls vary; retain listings already extracted. */ }
      }
      return parsed;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  async function browserExtract(company, url) {
    try {
      return await browserExtractOnce(company, url);
    } catch (error) {
      if (!/browser (?:has been )?closed|target page.*closed|browser\.newPage/i.test(error.message)) throw error;
      return browserExtractOnce(company, url);
    }
  }

  async function enrichDetails(jobs) {
    return mapLimited(jobs.filter(isPotentialJob).slice(0, 20), 4, async (job) => {
      try {
        const fetched = await fetchText(job.url, config.requestTimeoutMs);
        const parsed = extractFromHtml(fetched.text, fetched.finalUrl, job.company).jobs;
        const detail = parsed.find((value) => value.title) || null;
        if (detail) return { ...job, ...detail, company: job.company };
        return { ...job, description: clean(load(fetched.text)('body').text()).slice(0, 30_000), url: fetched.finalUrl };
      } catch {
        return job;
      }
    });
  }

  return {
    async crawl(company) {
      const workday = await crawlWorkday(company, config.requestTimeoutMs);
      if (workday) return { jobs: workday, method: 'workday-api' };

      let parsed;
      try {
        const fetched = await fetchText(targetedPortalUrl(company), config.requestTimeoutMs);
        parsed = extractFromHtml(fetched.text, fetched.finalUrl, company.company);
        if (!parsed.jobs.length && parsed.searchLinks.length) {
          const search = await fetchText(parsed.searchLinks[0], config.requestTimeoutMs);
          parsed = extractFromHtml(search.text, search.finalUrl, company.company);
        }
      } catch {
        parsed = { jobs: [], searchLinks: [] };
      }

      if (!parsed.jobs.length) {
        parsed = await browserExtract(company, company.portalUrl);
        if (!parsed.jobs.length && parsed.searchLinks.length) parsed = await browserExtract(company, parsed.searchLinks[0]);
      }
      return { jobs: await enrichDetails(uniqueJobs(parsed.jobs)), method: parsed.jobs.length ? 'html-or-browser' : 'no-listings-detected' };
    },
    async close() {
      if (browserPromise) {
        const instance = await browserPromise.catch(() => null);
        if (instance?.isConnected()) await instance.close();
      }
    },
  };
}

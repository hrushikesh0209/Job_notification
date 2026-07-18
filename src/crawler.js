import fs from 'node:fs';
import { load } from 'cheerio';
import { chromium } from 'playwright-core';
import { ADAPTERS } from './adapters.js';
import { bodyText, extractJobPostingFromHtml, mapLimited, normalizeJob, uniqueJobs } from './job-utils.js';
import { classifyHttpFailure, createHttpClient } from './http-client.js';
import { detectPlatform, isAuthorizedJobUrl, KNOWN_BROWSER_ONLY_PLATFORMS, SUPPORTED_API_PLATFORMS } from './platform.js';

const JOB_HREF = /(?:\/jobs?\/|jobid|job-id|job_id|jobdetail|job-detail|positions?\/|openings?\/|requisition|posting|vacanc)/i;
const SEARCH_TEXT = /^(?:search\s+jobs?|view\s+(?:all\s+)?jobs?|all\s+jobs?|open\s+positions?|job\s+openings?|find\s+jobs?)$/i;
const NEXT_TEXT = /^(?:next|next page|more jobs|show more|load more|›|»)$/i;
const ROLE_TEXT = /\b(?:software|sde|developer|backend|java|application|platform|engineer)\b/i;
const LOCATION_TEXT = /\b(?:india|hyderabad|bengaluru|bangalore|chennai|pune|gurugram|gurgaon|noida|mumbai|remote)\b/i;
const BLOCK_TEXT = /captcha|access denied|unusual traffic|verify (?:you are|that you're) human|request blocked|akamai reference|cloudflare ray id/i;

function cleanTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').replace(/^(?:learn\s+more\s+about|view\s+(?:the\s+)?job|job\s+details?\s*[:-]?)\s+/i, '').trim();
}

function locationFromText(text) {
  const value = String(text || '').replace(/\s+/g, ' ');
  const explicit = value.match(/(?:location|locations?)\s*:?\s*([^|•\n]{2,100})/i)?.[1];
  if (explicit && LOCATION_TEXT.test(explicit)) return explicit.trim();
  return value.match(/\b(?:remote(?:\s*[-–,]\s*india)?|(?:hyderabad|bengaluru|bangalore|chennai|pune|gurugram|gurgaon|noida|mumbai)(?:,\s*[A-Za-z ]{2,30})?(?:,\s*India)?|India)\b/i)?.[0] || '';
}

function parseHtml(html, pageUrl, company) {
  const structured = extractJobPostingFromHtml(html, pageUrl, company, company.portalUrl);
  if (structured.length) return { jobs: structured, searchLinks: [], nextLinks: [], blocked: false };
  const $ = load(html);
  const jobs = [];
  const searchLinks = [];
  const nextLinks = [];
  $('a[href]').each((_, element) => {
    const link = $(element);
    let href = '';
    try { href = new URL(link.attr('href'), pageUrl).href; } catch { return; }
    const text = cleanTitle(link.text() || link.attr('aria-label') || link.attr('title'));
    if (!href || !/^https?:/i.test(href)) return;
    if (SEARCH_TEXT.test(text) && isAuthorizedJobUrl(href, company.portalUrl)) searchLinks.push(href);
    if (NEXT_TEXT.test(text) && isAuthorizedJobUrl(href, company.portalUrl)) nextLinks.push(href);
    if (!JOB_HREF.test(href) || !isAuthorizedJobUrl(href, company.portalUrl)) return;
    const container = link.closest('li,article,tr,[class*="job"],[class*="position"],[class*="opening"],[class*="vacanc"]').first();
    const summary = (container.length ? container.text() : link.parent().text()).replace(/\s+/g, ' ').trim();
    const heading = container.find('h1,h2,h3,h4,[class*="title"]').first().text().replace(/\s+/g, ' ').trim();
    const title = cleanTitle(!/^(?:apply|view|learn more|details|read more)$/i.test(text) ? text : heading);
    if (!ROLE_TEXT.test(`${title} ${summary}`)) return;
    jobs.push(normalizeJob({ title: title || summary.slice(0, 160), location: locationFromText(summary), summary, url: href }, company, company.portalUrl));
  });
  return {
    jobs: uniqueJobs(jobs).filter((job) => job.authorizedUrl),
    searchLinks: [...new Set(searchLinks)],
    nextLinks: [...new Set(nextLinks)],
    blocked: BLOCK_TEXT.test($('body').text()),
  };
}

function targetedPortalUrl(company) {
  const url = new URL(company.portalUrl);
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'www.google.com' && url.pathname.includes('/careers/')) {
    url.searchParams.set('q', 'Software Engineer');
    url.searchParams.set('location', 'India');
  } else if (hostname.endsWith('amazon.jobs')) {
    url.pathname = '/en/search';
    url.searchParams.set('base_query', 'Software Engineer');
    url.searchParams.set('loc_query', 'India');
  } else if (hostname === 'jobs.careers.microsoft.com') {
    url.searchParams.set('q', 'Software Engineer');
    url.searchParams.set('lc', 'India');
  } else if (hostname === 'jobs.apple.com') {
    url.searchParams.set('search', 'Software Engineer');
    url.searchParams.set('location', 'india-INDC');
  }
  return url.href;
}

function browserExecutable(configured) {
  let bundled = '';
  try { bundled = chromium.executablePath(); } catch { /* Not installed. */ }
  return [
    configured, bundled, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean).find((candidate) => fs.existsSync(candidate)) || '';
}

class Semaphore {
  constructor(limit) { this.limit = Math.max(1, limit); this.active = 0; this.queue = []; }
  async use(worker) {
    if (this.active >= this.limit) await new Promise((resolve) => this.queue.push(resolve));
    this.active++;
    try { return await worker(); } finally { this.active--; this.queue.shift()?.(); }
  }
}

function emptyCoverage(company) {
  return {
    company: company.company,
    portalUrl: company.portalUrl,
    portalType: 'custom',
    httpStatus: null,
    finalUrl: '',
    retrievalMethod: 'none',
    jobsDiscovered: 0,
    detailsParsed: 0,
    accepted: 0,
    rejected: 0,
    rejectionReasons: {},
    pagination: { pagesFetched: 0, totalAvailable: null, complete: false, capped: false },
    durationMs: 0,
    errors: [],
    timeoutReason: '',
    status: 'broken',
  };
}

export async function createCrawler(config, dependencies = {}) {
  const http = dependencies.http || createHttpClient(config, dependencies);
  const browserGate = new Semaphore(config.browserConcurrency || 1);
  let browserPromise;
  let contextPromise;

  async function browserContext() {
    if (browserPromise) {
      const instance = await browserPromise.catch(() => null);
      if (!instance?.isConnected()) {
        browserPromise = null;
        contextPromise = null;
      }
    }
    if (!contextPromise) {
      const executablePath = browserExecutable(config.browserExecutable);
      if (!executablePath) throw new Error('Chromium, Chrome, or Edge was not found');
      browserPromise = chromium.launch({ executablePath, headless: true, args: ['--disable-gpu', '--disable-background-networking'] });
      contextPromise = browserPromise.then((instance) => instance.newContext({ userAgent: config.userAgent, viewport: { width: 1365, height: 900 } }));
    }
    return contextPromise;
  }

  async function resetBrowser() {
    const context = await contextPromise?.catch(() => null);
    const instance = await browserPromise?.catch(() => null);
    contextPromise = null;
    browserPromise = null;
    await context?.close().catch(() => {});
    await instance?.close().catch(() => {});
  }

  async function browserExtractOnce(company, url) {
    const context = await browserContext();
    const page = await context.newPage();
    try {
      page.setDefaultTimeout(config.browserTimeoutMs);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs });
      await page.waitForTimeout(config.browserSettleMs);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(500);
      const html = await page.content();
      return { ...parseHtml(html, page.url(), company), html, finalUrl: page.url(), httpStatus: response?.status() || null };
    } finally {
      await page.close().catch(() => {});
    }
  }

  async function browserExtract(company, url) {
    if (config.browserEnabled === false) throw new Error('Browser fallback disabled in fast mode');
    if (dependencies.browserExtract) return dependencies.browserExtract(company, url);
    return browserGate.use(async () => {
      try {
        return await browserExtractOnce(company, url);
      } catch (error) {
        if (!/browser.*closed|target page.*closed|context.*closed|Target\.createTarget|browserContext\.newPage/i.test(error.message)) throw error;
        await resetBrowser();
        return browserExtractOnce(company, url);
      }
    });
  }

  async function enrichGeneric(jobs) {
    const selected = jobs.slice(0, config.maxDetailJobsPerPortal);
    await mapLimited(selected, config.detailConcurrency, async (job) => {
      try {
        const response = await http.request(job.url);
        const structured = extractJobPostingFromHtml(response.text, response.finalUrl, { company: job.company }, job.url);
        const detail = structured[0];
        if (detail) Object.assign(job, detail, { company: job.company, authorizedUrl: true });
        else {
          job.description = bodyText(response.text);
          job.detailParsed = Boolean(job.description);
          job.url = response.finalUrl;
        }
      } catch (error) {
        job.detailError = error.message;
      }
    });
    return selected.filter((job) => job.detailParsed).length;
  }

  async function genericCrawl(company, initial, coverage) {
    let parsed = parseHtml(initial.text, initial.finalUrl, company);
    let jobs = [...parsed.jobs];
    const visited = new Set([initial.finalUrl]);
    let pages = 1;
    const queue = [...parsed.searchLinks.slice(0, 1), ...parsed.nextLinks.slice(0, 1)];
    while (queue.length && pages < config.maxGenericPages) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);
      try {
        const response = await http.request(url);
        const page = parseHtml(response.text, response.finalUrl, company);
        jobs.push(...page.jobs);
        queue.push(...page.nextLinks.slice(0, 1));
        parsed.blocked ||= page.blocked;
        pages++;
      } catch (error) {
        coverage.errors.push(error.message);
      }
    }

    let method = 'html';
    if (!jobs.length) {
      try {
        const rendered = await browserExtract(company, targetedPortalUrl(company));
        coverage.httpStatus = rendered.httpStatus || coverage.httpStatus;
        coverage.finalUrl = rendered.finalUrl || coverage.finalUrl;
        coverage.portalType = detectPlatform(rendered.finalUrl || company.portalUrl, rendered.html);
        parsed = rendered;
        jobs = rendered.jobs;
        method = 'browser';
        pages++;
      } catch (error) {
        coverage.errors.push(`Browser fallback: ${error.message}`);
        if (/Timeout/i.test(error.message)) coverage.timeoutReason = error.message;
      }
    }

    jobs = uniqueJobs(jobs).filter((job) => job.authorizedUrl).slice(0, config.maxJobsPerPortal);
    const detailsParsed = await enrichGeneric(jobs);
    const complete = Boolean(jobs.length) && !queue.length && jobs.length < config.maxJobsPerPortal;
    return {
      jobs,
      method,
      detailsParsed,
      blocked: parsed.blocked,
      pagination: { pagesFetched: pages, totalAvailable: null, complete, capped: jobs.length >= config.maxJobsPerPortal || Boolean(queue.length) },
    };
  }

  return {
    async crawl(company) {
      const started = Date.now();
      const coverage = emptyCoverage(company);
      let jobs = [];
      try {
        let initial = null;
        coverage.portalType = detectPlatform(company.portalUrl);
        if (coverage.portalType !== 'workday') {
          try {
            initial = await http.request(targetedPortalUrl(company));
            coverage.httpStatus = initial.status;
            coverage.finalUrl = initial.finalUrl;
            coverage.portalType = detectPlatform(initial.finalUrl, initial.text);
          } catch (error) {
            coverage.httpStatus = error.status || null;
            coverage.finalUrl = error.finalUrl || '';
            coverage.errors.push(error.message);
            if (error.timeout) coverage.timeoutReason = error.message;
          }
        }

        if (SUPPORTED_API_PLATFORMS.has(coverage.portalType)) {
          try {
            const adapted = await ADAPTERS[coverage.portalType](company, { http, config, html: initial?.text || '' });
            if (adapted) {
              jobs = adapted.jobs;
              coverage.retrievalMethod = adapted.method;
              coverage.httpStatus = adapted.httpStatus || coverage.httpStatus;
              coverage.detailsParsed = adapted.detailsParsed;
              coverage.pagination = adapted.pagination;
              coverage.status = jobs.length ? (adapted.pagination.complete && adapted.detailsParsed === jobs.length ? 'working' : 'partially working') : 'empty';
            }
          } catch (error) {
            coverage.errors.push(`${coverage.portalType} adapter: ${error.message}`);
            if (error.timeout) coverage.timeoutReason = error.message;
          }
        }

        if (coverage.retrievalMethod === 'none') {
          if (!initial) {
            try {
              const rendered = await browserExtract(company, targetedPortalUrl(company));
              initial = { text: rendered.html, finalUrl: rendered.finalUrl, status: rendered.httpStatus };
              coverage.httpStatus = rendered.httpStatus;
              coverage.finalUrl = rendered.finalUrl;
              coverage.portalType = detectPlatform(rendered.finalUrl, rendered.html);
            } catch (error) {
              coverage.errors.push(`Browser fallback: ${error.message}`);
              if (/Timeout/i.test(error.message)) coverage.timeoutReason = error.message;
            }
          }
          if (initial) {
            const generic = await genericCrawl(company, initial, coverage);
            jobs = generic.jobs;
            coverage.retrievalMethod = generic.method;
            coverage.detailsParsed = generic.detailsParsed;
            coverage.pagination = generic.pagination;
            if (jobs.length) coverage.status = !coverage.errors.length && generic.detailsParsed === jobs.length && generic.pagination.complete ? 'working' : 'partially working';
            else if (generic.blocked) coverage.status = 'blocked';
            else coverage.status = KNOWN_BROWSER_ONLY_PLATFORMS.has(coverage.portalType) ? 'unsupported' : 'unsupported';
          }
        }
      } catch (error) {
        coverage.errors.push(error.message);
        if (error.timeout) coverage.timeoutReason = error.message;
        coverage.status = classifyHttpFailure(error);
      }

      if (!jobs.length && coverage.errors.length && coverage.status === 'unsupported') {
        const blockedEvidence = coverage.httpStatus === 401 || coverage.httpStatus === 403 || coverage.httpStatus === 429
          || coverage.errors.some((message) => /HTTP (?:401|403|429)\b|captcha|access denied|request blocked/i.test(message));
        coverage.status = blockedEvidence ? 'blocked' : 'broken';
      }
      coverage.jobsDiscovered = jobs.length;
      coverage.durationMs = Date.now() - started;
      return { jobs, coverage, method: coverage.retrievalMethod };
    },
    async close() {
      await resetBrowser();
    },
  };
}

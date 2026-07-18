import { absoluteUrl, clean, mapLimited, normalizeJob, uniqueJobs } from './job-utils.js';
import { isPotentialJob } from './matcher.js';

function pagination(pagesFetched, totalAvailable, discovered, capped = false) {
  return {
    pagesFetched,
    totalAvailable: Number.isFinite(totalAvailable) ? totalAvailable : null,
    complete: !capped && (!Number.isFinite(totalAvailable) || discovered >= totalAvailable),
    capped,
  };
}

export function workdayParts(portalUrl) {
  const url = new URL(portalUrl);
  if (!/\.myworkdayjobs\.com$/i.test(url.hostname)) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const locale = /^[a-z]{2}-[A-Z]{2}$/.test(segments[0] || '') ? segments.shift() : '';
  const site = segments[0];
  const tenant = url.hostname.split('.')[0];
  return site ? { origin: url.origin, site, tenant, locale } : null;
}

export function greenhouseToken(portalUrl, html = '') {
  const url = new URL(portalUrl);
  if (/(?:^|\.)greenhouse\.io$/i.test(url.hostname)) {
    const token = url.pathname.split('/').filter(Boolean)[0];
    if (token && !['embed', 'jobs'].includes(token)) return token;
  }
  return html.match(/greenhouse\.io\/embed\/job_board\?for=([a-z0-9_-]+)/i)?.[1]
    || html.match(/boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i)?.[1]
    || html.match(/(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)/i)?.[1]
    || '';
}

export function leverSite(portalUrl, html = '') {
  const url = new URL(portalUrl);
  if (/(?:^|\.)lever\.co$/i.test(url.hostname)) return url.pathname.split('/').filter(Boolean)[0] || '';
  return html.match(/(?:jobs|api)\.lever\.co\/(?:v0\/postings\/)?([a-z0-9_-]+)/i)?.[1] || '';
}

export function smartRecruitersCompany(portalUrl, html = '') {
  const url = new URL(portalUrl);
  if (/(?:^|\.)smartrecruiters\.com$/i.test(url.hostname)) return url.pathname.split('/').filter(Boolean)[0] || '';
  return html.match(/smartrecruiters\.com\/(?:v1\/companies\/)?([a-z0-9_-]+)/i)?.[1] || '';
}

async function enrichDetails(jobs, http, config, detailUrl, parse) {
  const selected = [...jobs].sort((a, b) => Number(isPotentialJob(b)) - Number(isPotentialJob(a))).slice(0, config.maxDetailJobsPerPortal);
  await mapLimited(selected, config.detailConcurrency, async (job) => {
    try {
      const response = await http.json(detailUrl(job));
      Object.assign(job, parse(response.data, job));
      job.detailParsed = Boolean(job.description);
    } catch (error) {
      job.detailError = error.message;
    }
  });
  return selected.filter((job) => job.detailParsed).length;
}

export async function crawlWorkday(company, context) {
  const parts = workdayParts(company.portalUrl);
  if (!parts) return null;
  const endpoint = `${parts.origin}/wday/cxs/${parts.tenant}/${parts.site}/jobs`;
  const jobs = [];
  let pagesFetched = 0;
  let highestTotal = 0;
  let capped = false;
  for (const searchText of context.config.searchTerms) {
    for (let offset = 0; offset < context.config.maxPagesPerPortal * 20; offset += 20) {
      const response = await context.http.json(endpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText }),
      });
      pagesFetched++;
      const items = response.data.jobPostings || [];
      highestTotal = Math.max(highestTotal, Number(response.data.total) || items.length);
      for (const item of items) {
        const externalPath = item.externalPath || '';
        jobs.push(normalizeJob({
          title: item.title,
          location: item.locationsText || item.location,
          postingDate: item.postedOn,
          summary: [...(item.bulletFields || []), item.title, item.locationsText].join(' '),
          url: `${parts.origin}/${parts.site}${externalPath}`,
          jobId: externalPath.split('/').filter(Boolean).at(-1),
          detailPath: externalPath,
        }, company, company.portalUrl));
        jobs.at(-1).detailPath = externalPath;
      }
      if (items.length < 20 || offset + items.length >= (Number(response.data.total) || 0)) break;
      if (offset + 20 >= context.config.maxPagesPerPortal * 20) capped = true;
    }
  }
  const unique = uniqueJobs(jobs).filter((job) => job.authorizedUrl).slice(0, context.config.maxJobsPerPortal);
  if (unique.length < uniqueJobs(jobs).length) capped = true;
  const detailsParsed = await enrichDetails(unique, context.http, context.config,
    (job) => `${parts.origin}/wday/cxs/${parts.tenant}/${parts.site}${job.detailPath}`,
    (data, job) => {
      const value = data.jobPostingInfo || data;
      return {
        title: clean(value.title || job.title),
        location: clean(value.location || value.additionalLocations?.join(' / ') || job.location),
        postingDate: clean(value.startDate || value.postedOn || job.postingDate),
        description: clean(value.jobDescription || value.description),
        url: absoluteUrl(value.externalUrl || job.url, job.url),
      };
    });
  for (const job of unique) delete job.detailPath;
  return { jobs: unique, method: 'workday-api', httpStatus: 200, detailsParsed, pagination: pagination(pagesFetched, null, unique.length, capped) };
}

export async function crawlGreenhouse(company, context) {
  const token = context.token || greenhouseToken(company.portalUrl, context.html);
  if (!token) return null;
  const endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
  const response = await context.http.json(endpoint);
  const items = response.data.jobs || [];
  const jobs = items.map((item) => normalizeJob({
    title: item.title,
    location: item.location?.name,
    postingDate: item.updated_at,
    description: item.content,
    url: item.absolute_url,
    jobId: item.id,
  }, company, company.portalUrl)).filter((job) => job.authorizedUrl).slice(0, context.config.maxJobsPerPortal);
  return { jobs: uniqueJobs(jobs), method: 'greenhouse-api', httpStatus: response.status, detailsParsed: jobs.filter((job) => job.detailParsed).length, pagination: pagination(1, items.length, jobs.length, jobs.length < items.length) };
}

export async function crawlLever(company, context) {
  const site = context.site || leverSite(company.portalUrl, context.html);
  if (!site) return null;
  const jobs = [];
  let pagesFetched = 0;
  let capped = false;
  const limit = 100;
  for (let skip = 0; skip < context.config.maxPagesPerPortal * limit; skip += limit) {
    const endpoint = `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json&limit=${limit}&skip=${skip}`;
    const response = await context.http.json(endpoint);
    pagesFetched++;
    const items = Array.isArray(response.data) ? response.data : [];
    for (const item of items) jobs.push(normalizeJob({
      title: item.text,
      location: item.categories?.location,
      postingDate: item.createdAt ? new Date(item.createdAt).toISOString() : '',
      description: [item.descriptionPlain, ...(item.lists || []).map((list) => `${list.text} ${clean(list.content)}`), item.additionalPlain].join(' '),
      url: item.hostedUrl || item.applyUrl,
      jobId: item.id,
    }, company, company.portalUrl));
    if (items.length < limit) break;
    if (skip + limit >= context.config.maxPagesPerPortal * limit) capped = true;
  }
  const unique = uniqueJobs(jobs).filter((job) => job.authorizedUrl).slice(0, context.config.maxJobsPerPortal);
  if (unique.length < uniqueJobs(jobs).length) capped = true;
  return { jobs: unique, method: 'lever-api', httpStatus: 200, detailsParsed: unique.filter((job) => job.detailParsed).length, pagination: pagination(pagesFetched, null, unique.length, capped) };
}

export async function crawlSmartRecruiters(company, context) {
  const slug = context.slug || smartRecruitersCompany(company.portalUrl, context.html);
  if (!slug) return null;
  const jobs = [];
  let pagesFetched = 0;
  let total = 0;
  let capped = false;
  const limit = 100;
  for (let offset = 0; offset < context.config.maxPagesPerPortal * limit; offset += limit) {
    const endpoint = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=${limit}&offset=${offset}`;
    const response = await context.http.json(endpoint);
    pagesFetched++;
    const items = response.data.content || [];
    total = Number(response.data.totalFound) || items.length;
    for (const item of items) jobs.push(normalizeJob({
      title: item.name,
      location: [item.location?.city, item.location?.region, item.location?.country].filter(Boolean).join(', '),
      postingDate: item.releasedDate,
      summary: item.function?.label,
      url: `https://jobs.smartrecruiters.com/${slug}/${item.id}`,
      jobId: item.id,
    }, company, company.portalUrl));
    if (items.length < limit || offset + items.length >= total) break;
    if (offset + limit >= context.config.maxPagesPerPortal * limit) capped = true;
  }
  const unique = uniqueJobs(jobs).filter((job) => job.authorizedUrl).slice(0, context.config.maxJobsPerPortal);
  const detailsParsed = await enrichDetails(unique, context.http, context.config,
    (job) => `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings/${encodeURIComponent(job.jobId)}`,
    (data) => ({
      description: clean([data.jobAd?.sections?.jobDescription?.text, data.jobAd?.sections?.qualifications?.text, data.jobAd?.sections?.additionalInformation?.text].join(' ')),
    }));
  if (unique.length < jobs.length) capped = true;
  return { jobs: unique, method: 'smartrecruiters-api', httpStatus: 200, detailsParsed, pagination: pagination(pagesFetched, total, unique.length, capped) };
}

export const ADAPTERS = {
  workday: crawlWorkday,
  greenhouse: crawlGreenhouse,
  lever: crawlLever,
  smartrecruiters: crawlSmartRecruiters,
};

import { load } from 'cheerio';
import { isAuthorizedJobUrl } from './platform.js';

export function clean(value) {
  return String(value || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function absoluteUrl(href, base) {
  try {
    const url = new URL(href, base);
    url.pathname = url.pathname.replace(/(\/jobs\/results){2,}/gi, '/jobs/results');
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

export function normalizeJob(raw, company, portalUrl) {
  const url = absoluteUrl(raw.url || raw.applyUrl || '', portalUrl);
  return {
    company: company.company,
    title: clean(raw.title || raw.name),
    location: clean(raw.location || raw.locationsText || raw.jobLocationType),
    postingDate: clean(raw.postingDate || raw.datePosted || raw.postedOn),
    description: clean(raw.description || raw.content),
    summary: clean(raw.summary || raw.description || raw.content).slice(0, 1_500),
    url,
    jobId: clean(raw.jobId || raw.id || raw.requisitionId),
    authorizedUrl: isAuthorizedJobUrl(url, portalUrl),
    detailParsed: Boolean(clean(raw.description || raw.content)),
  };
}

export function uniqueJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = `${job.company}|${job.jobId || job.url}|${job.title}`.toLowerCase();
    if (!job.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function jsonLdValues(parsed) {
  if (Array.isArray(parsed)) return parsed.flatMap(jsonLdValues);
  if (parsed?.['@graph']) return jsonLdValues(parsed['@graph']);
  return parsed ? [parsed] : [];
}

export function extractJobPostingFromHtml(html, pageUrl, company, portalUrl) {
  const $ = load(html);
  const jobs = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const parsed = JSON.parse($(element).text());
      for (const value of jsonLdValues(parsed)) {
        if (!/JobPosting/i.test(String(value?.['@type'] || ''))) continue;
        const locationValue = value.jobLocation;
        const locations = (Array.isArray(locationValue) ? locationValue : [locationValue]).filter(Boolean).map((item) => {
          const address = item?.address || item;
          return [address?.addressLocality, address?.addressRegion, address?.addressCountry].filter(Boolean).join(', ');
        }).filter(Boolean);
        jobs.push(normalizeJob({
          title: value.title || value.name,
          location: locations.join(' / ') || value.jobLocationType,
          postingDate: value.datePosted,
          description: value.description,
          url: value.url || pageUrl,
          jobId: value.identifier?.value || value.identifier,
        }, company, portalUrl));
      }
    } catch { /* Invalid templated JSON-LD is common. */ }
  });
  return uniqueJobs(jobs).filter((job) => job.authorizedUrl);
}

export function bodyText(html) {
  return clean(load(html)('body').text()).slice(0, 50_000);
}

export async function mapLimited(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
  return results;
}

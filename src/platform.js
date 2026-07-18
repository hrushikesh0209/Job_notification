const ATS_HOSTS = [
  /\.myworkdayjobs\.com$/i,
  /(?:^|\.)greenhouse\.io$/i,
  /(?:^|\.)lever\.co$/i,
  /(?:^|\.)smartrecruiters\.com$/i,
  /(?:^|\.)eightfold\.ai$/i,
  /(?:^|\.)icims\.com$/i,
  /(?:^|\.)phenompeople\.com$/i,
  /(?:^|\.)successfactors\.(?:com|eu)$/i,
];

const AGGREGATORS = /(?:^|\.)(?:linkedin\.com|indeed\.com|naukri\.com|glassdoor\.(?:com|co\.in)|monster\.com)$/i;

function host(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function siteDomain(hostname) {
  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const suffix2 = parts.slice(-2).join('.');
  if (/^(?:co|com|org|net|gov|ac)\.(?:in|uk|au|nz|jp|sg|za)$/.test(suffix2)) return parts.slice(-3).join('.');
  return suffix2;
}

export function detectPlatform(portalUrl, html = '') {
  const hostname = host(portalUrl);
  const source = `${portalUrl}\n${html.slice(0, 1_000_000)}`;
  if (/\.myworkdayjobs\.com$/i.test(hostname) || /\/wday\/cxs\//i.test(source)) return 'workday';
  if (/greenhouse\.io/i.test(source) || /boards-api\.greenhouse/i.test(source)) return 'greenhouse';
  if (/lever\.co/i.test(source) || /api\.lever\.co\/v0\/postings/i.test(source)) return 'lever';
  if (/smartrecruiters\.com/i.test(source)) return 'smartrecruiters';
  if (/eightfold\.ai/i.test(source) || /eightfold/i.test(html)) return 'eightfold';
  if (/successfactors/i.test(source) || /career\d+\.successfactors/i.test(source)) return 'successfactors';
  if (/oraclecloud\.com.*(?:recruit|career)|\/hcmUI\/CandidateExperience|recruitingCEJobRequisitions/i.test(source)) return 'oracle-recruiting';
  if (/taleo\.net|tbe\.taleo/i.test(source)) return 'taleo';
  if (/icims\.com|icims/i.test(source)) return 'icims';
  if (/phenompeople\.com|ph-digital|phenom/i.test(source)) return 'phenom';
  return 'custom';
}

export function isAuthorizedJobUrl(jobUrl, portalUrl) {
  let job;
  let portal;
  try {
    job = new URL(jobUrl);
    portal = new URL(portalUrl);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(job.protocol) || AGGREGATORS.test(job.hostname)) return false;
  const jobHost = job.hostname.toLowerCase();
  const portalHost = portal.hostname.toLowerCase();
  if (jobHost === portalHost || jobHost.endsWith(`.${portalHost}`) || portalHost.endsWith(`.${jobHost}`) || siteDomain(jobHost) === siteDomain(portalHost)) return true;
  return ATS_HOSTS.some((pattern) => pattern.test(jobHost));
}

export const SUPPORTED_API_PLATFORMS = new Set(['workday', 'greenhouse', 'lever', 'smartrecruiters']);
export const KNOWN_BROWSER_ONLY_PLATFORMS = new Set(['eightfold', 'successfactors', 'oracle-recruiting', 'taleo', 'icims', 'phenom']);

import path from 'node:path';
import process from 'node:process';
import 'dotenv/config';

const root = process.cwd();
const githubActions = /^(1|true)$/i.test(process.env.GITHUB_ACTIONS || '');
const runMode = String(process.env.MONITOR_MODE || 'full').toLowerCase() === 'fast' ? 'fast' : 'full';

function int(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function bool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

export const config = {
  root,
  runMode,
  workbookPath: path.resolve(root, process.env.WORKBOOK_PATH || 'Final_Global_Software_Companies_Job_Portals.xlsx'),
  dataDir: path.resolve(root, 'data'),
  reportsDir: path.resolve(root, 'reports'),
  logsDir: path.resolve(root, 'logs'),
  concurrency: Math.max(1, Math.min(8, int('CONCURRENCY', 4))),
  perDomainConcurrency: Math.max(1, Math.min(4, int('PER_DOMAIN_CONCURRENCY', 2))),
  browserConcurrency: Math.max(1, Math.min(2, int('BROWSER_CONCURRENCY', 1))),
  detailConcurrency: Math.max(1, Math.min(8, int('DETAIL_CONCURRENCY', 4))),
  requestTimeoutMs: int('REQUEST_TIMEOUT_MS', runMode === 'fast' ? 12_000 : 20_000),
  browserTimeoutMs: int('BROWSER_TIMEOUT_MS', 25_000),
  browserSettleMs: int('BROWSER_SETTLE_MS', 1_500),
  requestRetries: Math.max(0, Math.min(5, int('REQUEST_RETRIES', 2))),
  retryBaseMs: Math.max(50, int('RETRY_BASE_MS', 400)),
  retryMaxMs: Math.max(500, int('RETRY_MAX_MS', 5_000)),
  maxPagesPerPortal: Math.max(1, Math.min(20, int('MAX_PAGES_PER_PORTAL', 5))),
  maxGenericPages: Math.max(1, Math.min(10, int('MAX_GENERIC_PAGES', 3))),
  maxJobsPerPortal: Math.max(20, Math.min(500, int('MAX_JOBS_PER_PORTAL', 150))),
  maxDetailJobsPerPortal: Math.max(10, Math.min(250, int('MAX_DETAIL_JOBS_PER_PORTAL', 80))),
  searchTerms: (process.env.SEARCH_TERMS || 'Java,Backend Software Engineer,Software Engineer')
    .split(',').map((value) => value.trim()).filter(Boolean),
  userAgent: process.env.USER_AGENT || 'OfficialCareerJobMonitor/2.0 (+official-company-portals-only)',
  maxCompanies: Math.max(0, int('MAX_COMPANIES', 0)),
  maxFastCompanies: Math.max(1, Math.min(100, int('MAX_FAST_COMPANIES', 60))),
  browserEnabled: bool('BROWSER_ENABLED', runMode !== 'fast'),
  notificationLimit: Math.max(1, Math.min(100, int('NOTIFICATION_LIMIT', runMode === 'fast' ? 15 : 30))),
  fastMinimumScore: Math.max(0, Math.min(100, int('FAST_MINIMUM_SCORE', 75))),
  pendingRetentionDays: Math.max(1, Math.min(30, int('PENDING_RETENTION_DAYS', 14))),
  browserExecutable: process.env.BROWSER_EXECUTABLE || '',
  githubActions,
  github: {
    token: process.env.GITHUB_TOKEN || '',
    repository: process.env.GITHUB_REPOSITORY || '',
    apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
    to: process.env.MAIL_TO || '',
  },
};

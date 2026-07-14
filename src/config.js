import path from 'node:path';
import process from 'node:process';
import 'dotenv/config';

const root = process.cwd();
const githubActions = /^(1|true)$/i.test(process.env.GITHUB_ACTIONS || '');

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
  workbookPath: path.resolve(root, process.env.WORKBOOK_PATH || 'Final_Global_Software_Companies_Job_Portals.xlsx'),
  dataDir: path.resolve(root, 'data'),
  reportsDir: path.resolve(root, 'reports'),
  logsDir: path.resolve(root, 'logs'),
  concurrency: Math.max(1, Math.min(8, int('CONCURRENCY', 4))),
  requestTimeoutMs: int('REQUEST_TIMEOUT_MS', 20_000),
  browserTimeoutMs: int('BROWSER_TIMEOUT_MS', 25_000),
  maxCompanies: Math.max(0, int('MAX_COMPANIES', 0)),
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

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { readCompanies } from './workbook.js';
import { createCrawler } from './crawler.js';
import { matchJob } from './matcher.js';
import { jobKey, loadState, saveState } from './state.js';
import { notify } from './notify.js';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const companyArgIndex = process.argv.indexOf('--company');
const companyFilter = companyArgIndex >= 0 ? process.argv[companyArgIndex + 1] || '' : '';

for (const directory of [config.dataDir, config.reportsDir, config.logsDir]) fs.mkdirSync(directory, { recursive: true });

function logLine(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  fs.appendFileSync(path.join(config.logsDir, 'monitor.log'), `${line}\n`, 'utf8');
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

let companies = readCompanies(config.workbookPath);
if (companyFilter) companies = companies.filter((item) => item.company.toLowerCase().includes(companyFilter.toLowerCase()));
if (config.maxCompanies) companies = companies.slice(0, config.maxCompanies);
if (!companies.length) throw new Error('No companies matched the workbook and command-line filters');

const state = loadState(config.dataDir);
const crawler = await createCrawler(config);
const errors = [];
const resultPath = path.join(config.dataDir, 'run-result.json');

function writeRunResult(result) {
  fs.writeFileSync(resultPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2)}\n`, 'utf8');
}

logLine(`Run started: ${companies.length} companies${dryRun ? ' (dry run)' : ''}`);
let crawled;
try {
  crawled = await mapConcurrent(companies, config.concurrency, async (company, index) => {
    try {
      const result = await crawler.crawl(company);
      logLine(`[${index + 1}/${companies.length}] ${company.company}: ${result.jobs.length} candidate jobs (${result.method})`);
      return result.jobs.map((job) => ({ ...job, company: company.company, priority: company.priority }));
    } catch (error) {
      errors.push({ company: company.company, error: error.message });
      logLine(`[${index + 1}/${companies.length}] ${company.company}: ERROR ${error.message}`);
      return [];
    }
  });
} finally {
  await crawler.close();
}

const matches = crawled.flat().map((job) => ({ job, result: matchJob(job) }))
  .filter(({ result }) => result.matched)
  .map(({ job, result }) => ({ ...job, ...result, key: jobKey(job) }))
  .filter((job, index, all) => all.findIndex((candidate) => candidate.key === job.key) === index)
  .filter((job) => !state.notified[job.key])
  .sort((a, b) => {
    const priority = { high: 3, medium: 2, low: 1 };
    return (priority[b.priority?.toLowerCase()] || 0) - (priority[a.priority?.toLowerCase()] || 0) || b.score - a.score;
  });

if (errors.length) fs.writeFileSync(path.join(config.logsDir, 'last-errors.json'), `${JSON.stringify(errors, null, 2)}\n`, 'utf8');

if (dryRun) {
  logLine(`Dry run complete: ${matches.length} new relevant matches; state and notifications unchanged; ${errors.length} portal errors`);
  for (const job of matches) console.log(`MATCH ${job.company} | ${job.title} | ${job.location} | ${job.url}`);
  writeRunResult({ status: 'dry-run', companiesChecked: companies.length, newMatches: matches.length, portalErrors: errors.length });
} else if (matches.length) {
  const delivery = await notify(matches, config);
  const now = new Date().toISOString();
  for (const job of matches) state.notified[job.key] = { company: job.company, title: job.title, url: job.url, notifiedAt: now };
  saveState(config.dataDir, state);
  const destinations = [delivery.githubIssueUrl, delivery.emailSent ? 'email' : ''].filter(Boolean).join(', ');
  logLine(`Notification created for ${matches.length} new jobs: ${delivery.reportPath}${destinations ? ` (${destinations})` : ''}`);
  for (const warning of delivery.warnings) logLine(`Notification warning: ${warning}`);
  writeRunResult({ status: 'notified', companiesChecked: companies.length, newMatches: matches.length, portalErrors: errors.length, ...delivery });
} else {
  logLine(`Run complete: no new relevant jobs; no notification sent; ${errors.length} portal errors`);
  writeRunResult({ status: 'no-new-matches', companiesChecked: companies.length, newMatches: 0, portalErrors: errors.length });
}

// Keep the ledger bounded while preserving a year of duplicate history.
if (!dryRun) {
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
  for (const [key, value] of Object.entries(state.notified)) {
    if (Date.parse(value.notifiedAt) < cutoff) delete state.notified[key];
  }
  saveState(config.dataDir, state);
}

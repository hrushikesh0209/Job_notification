import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { writeCoverage } from './coverage.js';
import { createCrawler } from './crawler.js';
import { matchJob } from './matcher.js';
import { notify } from './notify.js';
import { isAllowedOfficialPortal } from './portal-policy.js';
import { jobKey, loadState, saveState } from './state.js';
import { readCompanies } from './workbook.js';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const companyArgIndex = process.argv.indexOf('--company');
const companyFilter = companyArgIndex >= 0 ? process.argv[companyArgIndex + 1] || '' : '';

for (const directory of [config.dataDir, config.reportsDir, config.logsDir]) fs.mkdirSync(directory, { recursive: true });
const resultPath = path.join(config.dataDir, 'run-result.json');

function logLine(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  fs.appendFileSync(path.join(config.logsDir, 'monitor.log'), `${line}\n`, 'utf8');
}

function writeRunResult(result) {
  fs.writeFileSync(resultPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2)}\n`, 'utf8');
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

async function main() {
  const runStarted = Date.now();
  const workbookCompanies = readCompanies(config.workbookPath);
  const excludedPortals = workbookCompanies.filter((company) => !isAllowedOfficialPortal(company));
  let companies = workbookCompanies.filter(isAllowedOfficialPortal);
  if (companyFilter) companies = companies.filter((item) => item.company.toLowerCase().includes(companyFilter.toLowerCase()));
  if (config.maxCompanies) companies = companies.slice(0, config.maxCompanies);
  if (!companies.length) throw new Error('No companies matched the workbook and command-line filters');

  const state = loadState(config.dataDir);
  if (state.meta?.recovery) logLine(`State notice: ${state.meta.recovery.type}: ${state.meta.recovery.message}`);
  const crawler = await createCrawler(config);
  for (const portal of excludedPortals) logLine(`Skipped non-official generic job board: ${portal.company} (${portal.portalUrl})`);
  logLine(`Run started: ${companies.length} official company portals${dryRun ? ' (dry run)' : ''}`);

  let crawled;
  try {
    crawled = await mapConcurrent(companies, config.concurrency, async (company, index) => {
      const result = await crawler.crawl(company);
      const error = result.coverage.errors[0] ? `; ${result.coverage.errors[0]}` : '';
      logLine(`[${index + 1}/${companies.length}] ${company.company}: ${result.jobs.length} discovered, ${result.coverage.detailsParsed} parsed (${result.coverage.portalType}/${result.method}, ${result.coverage.status}, ${result.coverage.durationMs}ms${error})`);
      return { ...result, jobs: result.jobs.map((job) => ({ ...job, company: company.company, priority: company.priority })) };
    });
  } finally {
    await crawler.close();
  }

  const coverage = crawled.map((item) => item.coverage);
  const evaluated = [];
  for (let portalIndex = 0; portalIndex < crawled.length; portalIndex++) {
    const portal = crawled[portalIndex];
    const report = coverage[portalIndex];
    for (const job of portal.jobs) {
      const result = matchJob(job);
      evaluated.push({ job, result, portalIndex });
      if (result.matched) report.accepted++;
      else {
        report.rejected++;
        report.rejectionReasons[result.reasonCode] = (report.rejectionReasons[result.reasonCode] || 0) + 1;
      }
    }
  }

  const accepted = evaluated.filter(({ result }) => result.matched)
    .map(({ job, result }) => ({ ...job, ...result, key: jobKey(job) }));
  const uniqueAccepted = accepted.filter((job, index, all) => all.findIndex((candidate) => candidate.key === job.key) === index);
  const matches = uniqueAccepted.filter((job) => !state.notified[job.key]).sort((a, b) => {
    const priority = { high: 3, medium: 2, low: 1 };
    return (priority[b.priority?.toLowerCase()] || 0) - (priority[a.priority?.toLowerCase()] || 0) || b.score - a.score;
  });
  const duplicatesSuppressed = uniqueAccepted.length - matches.length;
  const coverageOutput = writeCoverage(config.reportsDir, coverage, { notified: dryRun ? 0 : matches.length, duplicatesSuppressed });
  const failures = coverage.filter((item) => ['blocked', 'broken', 'unsupported'].includes(item.status));
  fs.writeFileSync(path.join(config.logsDir, 'last-errors.json'), `${JSON.stringify(failures, null, 2)}\n`, 'utf8');

  const commonResult = {
    companiesChecked: companies.length,
    excludedPortals: excludedPortals.length,
    newMatches: matches.length,
    portalErrors: coverageOutput.summary.blocked + coverageOutput.summary.broken,
    durationMs: Date.now() - runStarted,
    coverage: coverageOutput.summary,
    coverageJson: coverageOutput.jsonPath,
    coverageCsv: coverageOutput.csvPath,
    stateRecovery: state.meta?.recovery || null,
  };

  if (dryRun) {
    logLine(`Dry run complete: ${matches.length} relevant matches; ${coverageOutput.summary.jobsDiscovered} discovered; ${coverageOutput.summary.detailsParsed} parsed; state and notifications unchanged`);
    for (const job of matches) console.log(`MATCH ${job.company} | ${job.title} | ${job.location} | ${job.url}`);
    writeRunResult({ status: 'dry-run', ...commonResult });
    return;
  }

  if (!matches.length) {
    logLine(`Run complete: no new relevant jobs; no notification sent; ${failures.length} unsupported/blocked/broken portals`);
    writeRunResult({ status: 'no-new-matches', ...commonResult });
    return;
  }

  try {
    const delivery = await notify(matches, config);
    const now = new Date().toISOString();
    for (const job of matches) state.notified[job.key] = { company: job.company, title: job.title, url: job.url, jobId: job.jobId || '', notifiedAt: now };
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
    for (const [key, value] of Object.entries(state.notified)) if (Date.parse(value.notifiedAt) < cutoff) delete state.notified[key];
    state.meta.lastSuccessfulNotificationAt = now;
    saveState(config.dataDir, state);
    const destinations = [delivery.githubIssueUrl, delivery.emailSent ? 'email' : ''].filter(Boolean).join(', ');
    logLine(`Notification created for ${matches.length} new jobs${destinations ? ` (${destinations})` : ''}`);
    for (const warning of delivery.warnings) logLine(`Notification warning: ${warning}`);
    writeRunResult({ status: 'notified', ...commonResult, ...delivery });
  } catch (error) {
    logLine(`Notification failed; state was not updated: ${error.message}`);
    writeRunResult({ status: 'notification-failed', ...commonResult, notificationError: error.message });
    throw error;
  }
}

main().catch((error) => {
  if (!fs.existsSync(resultPath)) writeRunResult({ status: 'failed', error: error.message, companiesChecked: 0, newMatches: 0, portalErrors: 0 });
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { writeCoverage } from './coverage.js';
import { createCrawler } from './crawler.js';
import { matchJob } from './matcher.js';
import { enqueueMatches, markDelivered, notificationCandidates, pruneState, selectNotificationBatch } from './notification-queue.js';
import { notify } from './notify.js';
import { isAllowedOfficialPortal } from './portal-policy.js';
import { recordPortalHealth, selectCompaniesForMode } from './run-mode.js';
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
  const officialCompanies = workbookCompanies.filter(isAllowedOfficialPortal);
  const loadedState = loadState(config.dataDir);
  const state = dryRun ? structuredClone(loadedState) : loadedState;
  let companies = companyFilter
    ? officialCompanies.filter((item) => item.company.toLowerCase().includes(companyFilter.toLowerCase()))
    : selectCompaniesForMode(officialCompanies, state, { mode: config.runMode, maxCompanies: config.maxFastCompanies });
  if (config.maxCompanies) companies = companies.slice(0, config.maxCompanies);
  if (!companies.length) throw new Error('No companies matched the workbook and command-line filters');

  if (state.meta?.recovery) logLine(`State notice: ${state.meta.recovery.type}: ${state.meta.recovery.message}`);
  const crawler = await createCrawler(config);
  for (const portal of excludedPortals) logLine(`Skipped non-official generic job board: ${portal.company} (${portal.portalUrl})`);
  const skippedByMode = officialCompanies.length - companies.length;
  logLine(`${config.runMode === 'fast' ? 'Fast' : 'Full'} run started: ${companies.length} official company portals${skippedByMode ? `; ${skippedByMode} deferred to the daily full scan` : ''}${dryRun ? ' (dry run)' : ''}`);

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
  recordPortalHealth(state, coverage);
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
  const duplicatesSuppressed = accepted.length - uniqueAccepted.length
    + (config.replayNotified ? 0 : uniqueAccepted.filter((job) => state.notified[job.key]).length);
  pruneState(state, { pendingDays: config.pendingRetentionDays });
  enqueueMatches(state, uniqueAccepted, new Date().toISOString(), { replayNotified: config.replayNotified });
  const notificationOptions = { mode: config.runMode, fastMinimumScore: config.fastMinimumScore, replayNotified: config.replayNotified };
  const eligibleMatches = notificationCandidates(state, notificationOptions);
  const matches = selectNotificationBatch(state, { ...notificationOptions, limit: config.notificationLimit });
  const deferredMatches = Object.keys(state.pending).length - matches.length;
  const coverageOutput = writeCoverage(config.reportsDir, coverage, { notified: 0, duplicatesSuppressed });
  const failures = coverage.filter((item) => ['blocked', 'broken', 'unsupported'].includes(item.status));
  fs.writeFileSync(path.join(config.logsDir, 'last-errors.json'), `${JSON.stringify(failures, null, 2)}\n`, 'utf8');

  const commonResult = {
    companiesChecked: companies.length,
    officialPortals: officialCompanies.length,
    skippedByMode,
    runMode: config.runMode,
    replayNotified: config.replayNotified,
    excludedPortals: excludedPortals.length,
    newMatches: matches.length,
    eligibleMatches: eligibleMatches.length,
    deferredMatches,
    pendingMatches: deferredMatches,
    notificationLimit: config.notificationLimit,
    portalErrors: coverageOutput.summary.blocked + coverageOutput.summary.broken,
    durationMs: Date.now() - runStarted,
    coverage: coverageOutput.summary,
    coverageJson: coverageOutput.jsonPath,
    coverageCsv: coverageOutput.csvPath,
    stateRecovery: state.meta?.recovery || null,
  };

  if (dryRun) {
    logLine(`Dry run complete: ${matches.length} notification candidates; ${deferredMatches} deferred; ${coverageOutput.summary.jobsDiscovered} discovered; ${coverageOutput.summary.detailsParsed} parsed; state and notifications unchanged`);
    for (const job of matches) console.log(`MATCH ${job.company} | ${job.title} | ${job.location} | ${job.url}`);
    writeRunResult({ status: 'dry-run', ...commonResult });
    return;
  }

  if (!matches.length) {
    saveState(config.dataDir, state);
    const status = Object.keys(state.pending).length ? 'deferred-only' : 'no-new-matches';
    logLine(`Run complete: no jobs eligible for this notification tier; ${Object.keys(state.pending).length} pending; ${failures.length} unsupported/blocked/broken portals`);
    writeRunResult({ status, ...commonResult });
    return;
  }

  try {
    const delivery = await notify(matches, config);
    const now = new Date().toISOString();
    markDelivered(state, matches, now);
    pruneState(state, { pendingDays: config.pendingRetentionDays });
    saveState(config.dataDir, state);
    commonResult.coverage = writeCoverage(config.reportsDir, coverage, { notified: matches.length, duplicatesSuppressed }).summary;
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

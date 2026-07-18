import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { markDigestDelivered, pruneState, selectDigestBatch } from './notification-queue.js';
import { notify } from './notify.js';
import { loadState, saveState } from './state.js';

for (const directory of [config.dataDir, config.reportsDir, config.logsDir]) fs.mkdirSync(directory, { recursive: true });
const resultPath = path.join(config.dataDir, 'run-result.json');

function writeRunResult(result) {
  fs.writeFileSync(resultPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2)}\n`, 'utf8');
}

function logLine(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  fs.appendFileSync(path.join(config.logsDir, 'monitor.log'), `${line}\n`, 'utf8');
}

async function main() {
  const started = Date.now();
  const state = loadState(config.dataDir);
  if (state.meta?.recovery) logLine(`State notice: ${state.meta.recovery.type}: ${state.meta.recovery.message}`);
  pruneState(state, { pendingDays: config.pendingRetentionDays, digestDays: 3 });
  const batch = selectDigestBatch(state, { limit: config.eodDigestLimit });
  const common = {
    runMode: 'digest',
    companiesChecked: 0,
    skippedByMode: 0,
    newMatches: batch.jobs.length,
    digestDate: batch.dateKey,
    digestTotal: batch.total,
    digestOmitted: batch.omitted,
    durationMs: Date.now() - started,
    stateRecovery: state.meta?.recovery || null,
  };

  if (!batch.jobs.length) {
    saveState(config.dataDir, state);
    logLine(`India EOD recap complete: no undigested jobs for ${batch.dateKey}`);
    writeRunResult({ status: 'no-digest-jobs', ...common });
    return;
  }

  try {
    const delivery = await notify(batch.jobs, config, {
      kind: 'daily-digest', digestDate: batch.dateKey, total: batch.total,
    });
    const now = new Date().toISOString();
    markDigestDelivered(state, batch.dateKey, now);
    pruneState(state, { pendingDays: config.pendingRetentionDays, digestDays: 3 });
    saveState(config.dataDir, state);
    logLine(`India EOD recap delivered for ${batch.dateKey}: ${batch.jobs.length} included${batch.omitted ? `, ${batch.omitted} omitted by cap` : ''}`);
    writeRunResult({ status: 'digest-notified', ...common, durationMs: Date.now() - started, ...delivery });
  } catch (error) {
    logLine(`India EOD recap failed; digest state was not updated: ${error.message}`);
    writeRunResult({ status: 'digest-failed', ...common, durationMs: Date.now() - started, notificationError: error.message });
    throw error;
  }
}

main().catch((error) => {
  if (!fs.existsSync(resultPath)) writeRunResult({ status: 'digest-failed', runMode: 'digest', newMatches: 0, error: error.message });
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

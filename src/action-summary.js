import fs from 'node:fs';
import path from 'node:path';

const resultPath = path.resolve('data', 'run-result.json');
let result = { status: 'failed', companiesChecked: 0, newMatches: 0, portalErrors: 0, coverage: {} };
try { result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch { /* Monitor failed before producing a result. */ }

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `matches=${Number(result.newMatches) || 0}\nstatus=${result.status || 'unknown'}\n`, 'utf8');
}

if (process.env.GITHUB_STEP_SUMMARY) {
  let lines;
  if (result.runMode === 'digest') {
    lines = [
      '# India EOD job recap', '',
      `- Status: **${result.status || 'unknown'}**`,
      `- India calendar date: **${result.digestDate || 'unknown'}**`,
      `- Jobs queued / included / omitted by cap: **${Number(result.digestTotal) || 0} / ${Number(result.newMatches) || 0} / ${Number(result.digestOmitted) || 0}**`,
      `- Runtime: **${Math.round((result.durationMs || 0) / 1000)}s**`,
    ];
    if (result.githubIssueUrl) lines.push(`- Recap notification: [GitHub Issue](${result.githubIssueUrl})`);
    if (result.stateRecovery) lines.push(`- State notice: **${result.stateRecovery.type}** - ${result.stateRecovery.message}`);
    lines.push('', result.newMatches
      ? 'The `notification-reports` artifact contains the India EOD HTML and Markdown recap.'
      : 'No recap was sent because the India-day digest queue was empty or already delivered.');
  } else {
    const coverage = result.coverage || {};
    lines = [
      '# Official career job monitor', '',
      `- Status: **${result.status || 'unknown'}**`,
      `- Scan mode: **${result.runMode || 'unknown'}**`,
      `- One-time duplicate replay: **${result.replayNotified ? 'enabled' : 'disabled'}**`,
      `- Portals attempted: **${Number(result.companiesChecked) || 0}**`,
      `- Portals deferred to daily full scan: **${Number(result.skippedByMode) || 0}**`,
      `- Working / partial / confirmed empty: **${coverage.working || 0} / ${coverage.partiallyWorking || 0} / ${coverage.empty || 0}**`,
      `- Unsupported / blocked / broken: **${coverage.unsupported || 0} / ${coverage.blocked || 0} / ${coverage.broken || 0}**`,
      `- Jobs discovered / details parsed: **${coverage.jobsDiscovered || 0} / ${coverage.detailsParsed || 0}**`,
      `- Accepted / rejected: **${coverage.accepted || 0} / ${coverage.rejected || 0}**`,
      `- Notification batch / pending after batch / duplicate suppressions: **${Number(result.newMatches) || 0} / ${Number(result.deferredMatches) || 0} / ${coverage.duplicatesSuppressed || 0}**`,
      `- Runtime: **${Math.round((result.durationMs || 0) / 1000)}s**`,
    ];
    if (result.githubIssueUrl) lines.push(`- Notification: [GitHub Issue](${result.githubIssueUrl})`);
    if (result.stateRecovery) lines.push(`- State notice: **${result.stateRecovery.type}** - ${result.stateRecovery.message}`);
    const reasons = Object.entries(coverage.rejectionReasons || {}).sort((a, b) => b[1] - a[1]);
    if (reasons.length) {
      lines.push('', '## Rejection reasons', '', '| Code | Count |', '| --- | ---: |');
      for (const [code, count] of reasons) lines.push(`| ${code} | ${count} |`);
    }
    if (coverage.slowestPortals?.length) {
      lines.push('', '## Slowest portals', '', '| Company | Duration | Status |', '| --- | ---: | --- |');
      for (const item of coverage.slowestPortals) lines.push(`| ${item.company} | ${(item.durationMs / 1000).toFixed(1)}s | ${item.status} |`);
    }
    lines.push('', result.runMode === 'full'
      ? 'The `portal-coverage` artifact contains the full company-by-company JSON and CSV report plus a compact state backup.'
      : 'Fast runs keep the summary lightweight; full coverage artifacts are uploaded by the daily full scan and by failed runs.');
  }
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, 'utf8');
}

import fs from 'node:fs';
import path from 'node:path';

const resultPath = path.resolve('data', 'run-result.json');
let result = { status: 'failed', companiesChecked: 0, newMatches: 0, portalErrors: 0 };
try { result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch { /* The monitor may have failed before producing a result. */ }

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `matches=${Number(result.newMatches) || 0}\nstatus=${result.status || 'unknown'}\n`, 'utf8');
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '# Official career job monitor',
    '',
    `- Status: **${result.status || 'unknown'}**`,
    `- Companies checked: **${Number(result.companiesChecked) || 0}**`,
    `- New relevant matches: **${Number(result.newMatches) || 0}**`,
    `- Portal errors: **${Number(result.portalErrors) || 0}**`,
  ];
  if (result.githubIssueUrl) lines.push(`- Notification: [GitHub Issue](${result.githubIssueUrl})`);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, 'utf8');
}

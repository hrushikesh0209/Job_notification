import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const escapeMarkdown = (value) => String(value ?? '').replace(/([\\`*_{}[\]()<>#+.!|])/g, '\\$1').replace(/\s+/g, ' ').trim();

function safeLink(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.href : '#';
  } catch { return '#'; }
}

function labels(jobs, options = {}) {
  const digest = options.kind === 'daily-digest';
  const count = `${jobs.length} job${jobs.length === 1 ? '' : 's'}`;
  return digest ? {
    heading: `India EOD recap: ${count}`,
    context: options.total > jobs.length
      ? `Top ${jobs.length} of ${options.total} jobs notified on ${options.digestDate || 'the India calendar day'}`
      : `Jobs notified on ${options.digestDate || 'the India calendar day'}`,
    subject: `[Job Monitor] India EOD recap - ${options.digestDate || ''} - ${count}`,
    issueTitle: `[Job Monitor] India EOD recap - ${options.digestDate || ''} - ${count}`,
    prefix: 'eod-recap',
    latest: 'latest-eod',
  } : {
    heading: `${jobs.length} new relevant job${jobs.length === 1 ? '' : 's'}`,
    context: 'Official career portals checked',
    subject: `${jobs.length} new relevant official-portal job${jobs.length === 1 ? '' : 's'}`,
    issueTitle: `[Job Monitor] ${jobs.length} new relevant job${jobs.length === 1 ? '' : 's'}`,
    prefix: 'new-jobs',
    latest: 'latest',
  };
}

export function reportHtml(jobs, generatedAt, options = {}) {
  const copy = labels(jobs, options);
  const cards = jobs.map((job) => `
    <article>
      <div class="score">Match ${job.score}/100</div>
      <h2>${escapeHtml(job.title)}</h2>
      <p class="company">${escapeHtml(job.company)}</p>
      <dl>
        <dt>Location</dt><dd>${escapeHtml(job.location || 'Not specified')}</dd>
        <dt>Posting date</dt><dd>${escapeHtml(job.postingDate || 'Not available')}</dd>
        <dt>Required experience</dt><dd>${escapeHtml(job.experience)}</dd>
        <dt>Relevant skills</dt><dd>${escapeHtml(job.skills.length ? job.skills.join(', ') : 'No exact stack keywords detected')}</dd>
      </dl>
      <p>${escapeHtml(job.explanation)}</p>
      <a class="apply" href="${escapeHtml(safeLink(job.url))}">Apply on the official career portal</a>
    </article>`).join('\n');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(copy.heading)}</title>
  <style>body{font:16px/1.55 system-ui,sans-serif;background:#f4f7fb;color:#172033;margin:0}.wrap{max-width:920px;margin:auto;padding:32px 18px}h1{margin-bottom:4px}header p{color:#526078}article{position:relative;background:white;border:1px solid #dbe3ef;border-radius:14px;padding:24px;margin:18px 0;box-shadow:0 4px 15px #1b31500d}h2{margin:0 100px 0 0}.company{font-weight:650;color:#3453a3}.score{position:absolute;right:20px;top:22px;background:#e7f4ec;color:#17683a;padding:5px 10px;border-radius:99px;font-size:13px;font-weight:700}dl{display:grid;grid-template-columns:160px 1fr;gap:6px 14px}dt{font-weight:700}dd{margin:0}.apply{display:inline-block;background:#2457d6;color:white;text-decoration:none;padding:10px 15px;border-radius:8px;font-weight:700}@media(max-width:600px){dl{grid-template-columns:1fr}h2{margin-right:0}.score{position:static;display:inline-block;margin-bottom:10px}}</style></head>
  <body><div class="wrap"><header><h1>${escapeHtml(copy.heading)}</h1><p>${escapeHtml(copy.context)} - ${escapeHtml(generatedAt)}</p></header>${cards}</div></body></html>`;
}

export function reportMarkdown(jobs, generatedAt, maxLength = Number.POSITIVE_INFINITY, options = {}) {
  const copy = labels(jobs, options);
  let report = `# ${escapeMarkdown(copy.heading)}\n\n${escapeMarkdown(copy.context)} - ${escapeMarkdown(generatedAt)}\n`;
  let included = 0;

  for (const job of jobs) {
    const section = `\n---\n\n## ${escapeMarkdown(job.company)} - ${escapeMarkdown(job.title)}\n\n` +
      `- **Location:** ${escapeMarkdown(job.location || 'Not specified')}\n` +
      `- **Posting date:** ${escapeMarkdown(job.postingDate || 'Not available')}\n` +
      `- **Required experience:** ${escapeMarkdown(job.experience || 'Not specified')}\n` +
      `- **Relevant skills:** ${escapeMarkdown(job.skills?.length ? job.skills.join(', ') : 'No exact stack keywords detected')}\n` +
      `- **Match score:** ${Number(job.score) || 0}/100\n\n` +
      `${escapeMarkdown(job.explanation)}\n\n` +
      `[Apply on the official career portal](${safeLink(job.url)})\n`;
    if (report.length + section.length > maxLength) break;
    report += section;
    included++;
  }

  if (included < jobs.length) report += `\n---\n\n_${jobs.length - included} additional matches are available in the attached workflow report artifact._\n`;
  return report;
}

async function sendEmail(jobs, html, markdown, config, options) {
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  await transporter.sendMail({
    from: config.smtp.from,
    to: config.smtp.to,
    subject: labels(jobs, options).subject,
    html,
    text: markdown,
  });
}

async function createGitHubIssue(jobs, markdown, config, options) {
  const endpoint = `${config.github.apiUrl.replace(/\/$/, '')}/repos/${config.github.repository}/issues`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${config.github.token}`,
      'content-type': 'application/json',
      'user-agent': 'official-career-job-monitor',
    },
    body: JSON.stringify({
      title: labels(jobs, options).issueTitle,
      body: markdown,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`GitHub Issue API returned HTTP ${response.status}: ${detail}`);
  }
  return response.json();
}

export async function notify(jobs, config, options = {}) {
  fs.mkdirSync(config.reportsDir, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const generatedAt = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const copy = labels(jobs, options);
  const html = reportHtml(jobs, generatedAt, options);
  const markdown = reportMarkdown(jobs, generatedAt, Number.POSITIVE_INFINITY, options);
  const issueMarkdown = reportMarkdown(jobs, generatedAt, 60_000, options);
  const reportPath = path.join(config.reportsDir, `${copy.prefix}-${stamp}.html`);
  const markdownPath = path.join(config.reportsDir, `${copy.prefix}-${stamp}.md`);
  fs.writeFileSync(reportPath, html, 'utf8');
  fs.writeFileSync(markdownPath, markdown, 'utf8');
  fs.writeFileSync(path.join(config.reportsDir, `${copy.latest}.html`), html, 'utf8');
  fs.writeFileSync(path.join(config.reportsDir, `${copy.latest}.md`), markdown, 'utf8');

  const delivery = { reportPath, markdownPath, emailSent: false, githubIssueUrl: '', warnings: [] };
  const emailConfigured = Boolean(config.smtp.host && config.smtp.to && config.smtp.from);
  const githubConfigured = Boolean(config.github.token && config.github.repository);

  if (emailConfigured) {
    try {
      await sendEmail(jobs, html, markdown, config, options);
      delivery.emailSent = true;
    } catch (error) {
      delivery.warnings.push(`Email failed: ${error.message}`);
    }
  }

  if (githubConfigured) {
    try {
      const issue = await createGitHubIssue(jobs, issueMarkdown, config, options);
      delivery.githubIssueUrl = issue.html_url || '';
    } catch (error) {
      delivery.warnings.push(`GitHub Issue failed: ${error.message}`);
    }
  }

  if (config.githubActions && !delivery.emailSent && !delivery.githubIssueUrl) {
    const details = delivery.warnings.length ? delivery.warnings.join('; ') : 'GITHUB_TOKEN/GITHUB_REPOSITORY were not provided and SMTP is not configured';
    throw new Error(`No notification channel succeeded; duplicate state was not updated. ${details}`);
  }

  return delivery;
}

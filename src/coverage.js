import fs from 'node:fs';
import path from 'node:path';

function csv(value) {
  const text = typeof value === 'object' && value != null ? JSON.stringify(value) : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export function summarizeCoverage(coverage, totals = {}) {
  const statuses = {};
  const rejectionReasons = {};
  for (const item of coverage) {
    statuses[item.status] = (statuses[item.status] || 0) + 1;
    for (const [reason, count] of Object.entries(item.rejectionReasons || {})) rejectionReasons[reason] = (rejectionReasons[reason] || 0) + count;
  }
  return {
    portalsAttempted: coverage.length,
    working: statuses.working || 0,
    partiallyWorking: statuses['partially working'] || 0,
    empty: statuses.empty || 0,
    unsupported: statuses.unsupported || 0,
    blocked: statuses.blocked || 0,
    broken: statuses.broken || 0,
    jobsDiscovered: coverage.reduce((sum, item) => sum + item.jobsDiscovered, 0),
    detailsParsed: coverage.reduce((sum, item) => sum + item.detailsParsed, 0),
    accepted: coverage.reduce((sum, item) => sum + item.accepted, 0),
    rejected: coverage.reduce((sum, item) => sum + item.rejected, 0),
    rejectionReasons,
    notified: totals.notified || 0,
    duplicatesSuppressed: totals.duplicatesSuppressed || 0,
    slowestPortals: [...coverage].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10)
      .map(({ company, durationMs, status }) => ({ company, durationMs, status })),
  };
}

export function writeCoverage(reportsDir, coverage, totals = {}, generatedAt = new Date().toISOString()) {
  fs.mkdirSync(reportsDir, { recursive: true });
  const summary = summarizeCoverage(coverage, totals);
  const document = { schemaVersion: 1, generatedAt, summary, companies: coverage };
  const jsonPath = path.join(reportsDir, 'coverage.json');
  const csvPath = path.join(reportsDir, 'coverage.csv');
  fs.writeFileSync(jsonPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  const fields = [
    'company', 'portalUrl', 'portalType', 'httpStatus', 'finalUrl', 'retrievalMethod', 'jobsDiscovered', 'detailsParsed',
    'accepted', 'rejected', 'rejectionReasons', 'pagination', 'durationMs', 'errors', 'timeoutReason', 'status',
  ];
  const lines = [fields.map(csv).join(',')];
  for (const item of coverage) lines.push(fields.map((field) => csv(item[field])).join(','));
  fs.writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf8');
  return { summary, jsonPath, csvPath };
}

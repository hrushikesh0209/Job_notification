import { detectPlatform, SUPPORTED_API_PLATFORMS } from './platform.js';

// Seeded from the 2026-07-18 controlled coverage scan. These portals produced
// trustworthy results without browser rendering. Portal health learned by later
// full runs can add or remove companies from the fast tier automatically.
export const FAST_PORTAL_SEED = new Set([
  'Google', 'NVIDIA', 'Intuit', 'Expedia Group', 'Wells Fargo', 'Visa', 'Barclays',
  'Citi', 'Stripe', 'Razorpay', 'Nutanix', 'Palo Alto Networks', 'Freshworks',
  'Druva', 'Coinbase', 'Siemens', 'Airbnb', 'Grafana Labs', 'Figma', 'Canva',
  'Autodesk', 'Workday', 'UiPath', 'Nasdaq', 'Applied Materials', 'Reddit', 'Zoom',
  'Asana', 'Miro', 'DoorDash', 'Grab', 'Agoda', 'Tripadvisor', 'Wise', 'Plaid',
  "Moody's", 'Capital One', 'Societe Generale', 'Ford', 'General Motors', 'HARMAN',
  'Stryker', 'Johnson & Johnson',
]);

const GOOD_STATUSES = new Set(['working', 'partially working']);

function priorityValue(value) {
  return ({ high: 3, medium: 2, low: 1 })[String(value || '').toLowerCase()] || 0;
}

function healthDecision(health, now, maxAgeMs) {
  if (!health) return null;
  const checkedAt = Date.parse(health.checkedAt || '');
  if (!Number.isFinite(checkedAt) || now - checkedAt > maxAgeMs) return null;
  return GOOD_STATUSES.has(health.status) && health.retrievalMethod !== 'browser';
}

export function selectCompaniesForMode(companies, state, options = {}) {
  const mode = options.mode === 'fast' ? 'fast' : 'full';
  if (mode === 'full') return [...companies];

  const maxCompanies = Math.max(1, options.maxCompanies || 60);
  const now = options.now || Date.now();
  const maxHealthAgeMs = (options.healthDays || 14) * 24 * 60 * 60 * 1000;
  const health = state?.portalHealth || {};

  return companies
    .filter((company) => {
      const learned = healthDecision(health[company.company], now, maxHealthAgeMs);
      const directApi = SUPPORTED_API_PLATFORMS.has(detectPlatform(company.portalUrl));
      return learned ?? (directApi || FAST_PORTAL_SEED.has(company.company));
    })
    .sort((a, b) => {
      const priority = priorityValue(b.priority) - priorityValue(a.priority);
      if (priority) return priority;
      const aDuration = health[a.company]?.durationMs ?? Number.MAX_SAFE_INTEGER;
      const bDuration = health[b.company]?.durationMs ?? Number.MAX_SAFE_INTEGER;
      return aDuration - bDuration || a.workbookRow - b.workbookRow;
    })
    .slice(0, maxCompanies);
}

export function recordPortalHealth(state, coverage, checkedAt = new Date().toISOString()) {
  state.portalHealth ||= {};
  for (const item of coverage) {
    state.portalHealth[item.company] = {
      status: item.status,
      portalType: item.portalType,
      retrievalMethod: item.retrievalMethod,
      durationMs: item.durationMs,
      checkedAt,
    };
  }
}

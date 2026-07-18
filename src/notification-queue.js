const DAY_MS = 24 * 60 * 60 * 1000;

function clipped(value, max = 1_000) {
  return String(value || '').slice(0, max);
}

function compactJob(job, firstSeenAt) {
  return {
    key: job.key,
    company: clipped(job.company, 200),
    title: clipped(job.title, 300),
    location: clipped(job.location, 300),
    postingDate: clipped(job.postingDate, 80),
    experience: clipped(job.experience, 300),
    skills: Array.isArray(job.skills) ? job.skills.slice(0, 20).map((value) => clipped(value, 100)) : [],
    explanation: clipped(job.explanation, 1_500),
    score: Number(job.score) || 0,
    url: clipped(job.url, 2_000),
    jobId: clipped(job.jobId, 300),
    priority: clipped(job.priority, 30),
    firstSeenAt,
  };
}

export function indiaDateKey(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function enqueueMatches(state, jobs, now = new Date().toISOString(), options = {}) {
  state.pending ||= {};
  for (const job of jobs) {
    if (!job.key || (state.notified?.[job.key] && !options.replayNotified)) continue;
    const firstSeenAt = state.pending[job.key]?.firstSeenAt || now;
    state.pending[job.key] = compactJob(job, firstSeenAt);
  }
}

export function pruneState(state, options = {}) {
  const now = options.now || Date.now();
  const notifiedCutoff = now - (options.notifiedDays || 365) * DAY_MS;
  const pendingCutoff = now - (options.pendingDays || 14) * DAY_MS;
  const digestCutoff = now - (options.digestDays || 3) * DAY_MS;
  state.notified ||= {};
  state.pending ||= {};
  state.digestQueue ||= {};

  for (const [key, value] of Object.entries(state.notified)) {
    if (!Number.isFinite(Date.parse(value.notifiedAt || '')) || Date.parse(value.notifiedAt) < notifiedCutoff) delete state.notified[key];
  }
  for (const [key, value] of Object.entries(state.pending)) {
    if (state.notified[key] || !Number.isFinite(Date.parse(value.firstSeenAt || '')) || Date.parse(value.firstSeenAt) < pendingCutoff) delete state.pending[key];
  }
  for (const [key, value] of Object.entries(state.digestQueue)) {
    if (!Number.isFinite(Date.parse(value.notifiedAt || '')) || Date.parse(value.notifiedAt) < digestCutoff) delete state.digestQueue[key];
  }
}

export function notificationCandidates(state, options = {}) {
  const minimumScore = options.mode === 'fast' ? options.fastMinimumScore ?? 75 : 0;
  const priority = { high: 3, medium: 2, low: 1 };
  return Object.values(state.pending || {})
    .filter((job) => (options.replayNotified || !state.notified?.[job.key]) && job.score >= minimumScore)
    .sort((a, b) =>
      (priority[String(b.priority).toLowerCase()] || 0) - (priority[String(a.priority).toLowerCase()] || 0)
      || b.score - a.score
      || Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt));
}

export function selectNotificationBatch(state, options = {}) {
  const limit = Math.max(1, Number(options.limit) || 1);
  return notificationCandidates(state, options).slice(0, limit);
}

export function markDelivered(state, jobs, now = new Date().toISOString()) {
  state.notified ||= {};
  state.pending ||= {};
  state.digestQueue ||= {};
  for (const job of jobs) {
    state.notified[job.key] = {
      company: job.company,
      title: job.title,
      url: job.url,
      jobId: job.jobId || '',
      notifiedAt: now,
    };
    state.digestQueue[job.key] = { ...compactJob(job, job.firstSeenAt || now), notifiedAt: now, digestDate: indiaDateKey(now) };
    delete state.pending[job.key];
  }
  state.meta ||= {};
  state.meta.lastSuccessfulNotificationAt = now;
}

export function selectDigestBatch(state, options = {}) {
  const limit = Math.max(1, Number(options.limit) || 30);
  const today = options.today || indiaDateKey(options.now || Date.now());
  const entries = Object.values(state.digestQueue || {}).filter((job) => job.digestDate && job.digestDate <= today);
  const availableDates = [...new Set(entries.map((job) => job.digestDate))].sort();
  const dateKey = options.dateKey || availableDates[0] || today;

  const priority = { high: 3, medium: 2, low: 1 };
  const jobs = entries.filter((job) => job.digestDate === dateKey).sort((a, b) =>
    (priority[String(b.priority).toLowerCase()] || 0) - (priority[String(a.priority).toLowerCase()] || 0)
    || b.score - a.score
    || Date.parse(a.notifiedAt) - Date.parse(b.notifiedAt));
  return { dateKey, jobs: jobs.slice(0, limit), total: jobs.length, omitted: Math.max(0, jobs.length - limit) };
}

export function markDigestDelivered(state, dateKey, now = new Date().toISOString()) {
  state.digestQueue ||= {};
  for (const [key, job] of Object.entries(state.digestQueue)) if (job.digestDate === dateKey) delete state.digestQueue[key];
  state.meta ||= {};
  state.meta.lastDigestDate = dateKey;
  state.meta.lastDigestAt = now;
}

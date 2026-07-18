const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'HttpError';
    Object.assign(this, details);
  }
}

class Semaphore {
  constructor(limit) {
    this.limit = Math.max(1, limit);
    this.active = 0;
    this.queue = [];
  }

  async use(worker) {
    if (this.active >= this.limit) await new Promise((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await worker();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export function createHttpClient(config, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const sleep = dependencies.sleep || delay;
  const random = dependencies.random || Math.random;
  const domains = new Map();
  const userAgent = config.userAgent || 'OfficialCareerJobMonitor/2.0 (+official-company-portals-only)';

  function semaphore(url) {
    const hostname = new URL(url).hostname.toLowerCase();
    if (!domains.has(hostname)) domains.set(hostname, new Semaphore(config.perDomainConcurrency || 2));
    return domains.get(hostname);
  }

  async function request(url, options = {}) {
    const retries = options.retries ?? config.requestRetries ?? 2;
    const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs ?? 20_000;
    const accepted = options.acceptStatus || ((status) => status >= 200 && status < 300);
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await semaphore(url).use(() => fetchImpl(url, {
          redirect: 'follow',
          ...options,
          headers: {
            'user-agent': userAgent,
            accept: 'text/html,application/xhtml+xml,application/json',
            ...(options.headers || {}),
          },
          signal: AbortSignal.timeout(timeoutMs),
        }));
        const body = await response.text();
        if (!accepted(response.status)) {
          throw new HttpError(`HTTP ${response.status} for ${url}`, {
            status: response.status,
            url,
            finalUrl: response.url || url,
            bodySnippet: body.slice(0, 300),
            retryable: RETRYABLE_STATUS.has(response.status),
          });
        }
        return {
          text: body,
          status: response.status,
          finalUrl: response.url || url,
          contentType: response.headers?.get?.('content-type') || '',
          headers: response.headers,
          attempts: attempt + 1,
        };
      } catch (error) {
        lastError = error;
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        const retryable = timeout || error?.retryable || /ECONNRESET|EAI_AGAIN|fetch failed|network/i.test(error?.message || '');
        if (attempt >= retries || !retryable) break;
        const retryAfter = Number.parseFloat(error?.headers?.get?.('retry-after') || '');
        const exponential = (config.retryBaseMs || 400) * (2 ** attempt);
        const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : exponential + random() * exponential * 0.4;
        await sleep(Math.min(waitMs, config.retryMaxMs || 5_000));
      }
    }

    if (lastError instanceof HttpError) throw lastError;
    const timeout = lastError?.name === 'TimeoutError' || lastError?.name === 'AbortError';
    throw new HttpError(`${timeout ? 'Timeout' : 'Network error'} for ${url}: ${lastError?.message || 'unknown error'}`, {
      url,
      timeout,
      retryable: true,
      cause: lastError,
    });
  }

  return {
    request,
    async json(url, options = {}) {
      const response = await request(url, options);
      try {
        return { ...response, data: JSON.parse(response.text) };
      } catch (error) {
        throw new HttpError(`Invalid JSON from ${url}: ${error.message}`, {
          status: response.status,
          finalUrl: response.finalUrl,
          bodySnippet: response.text.slice(0, 300),
        });
      }
    },
  };
}

export function classifyHttpFailure(error) {
  if (error?.status === 401 || error?.status === 403 || error?.status === 429) return 'blocked';
  if (error?.timeout) return 'broken';
  if (/captcha|access denied|forbidden|robot|consent/i.test(`${error?.message || ''} ${error?.bodySnippet || ''}`)) return 'blocked';
  return 'broken';
}

# Official Career Job Monitor

A four-hourly GitHub Actions monitor for the official company career links in `Final_Global_Software_Companies_Job_Portals.xlsx`. It discovers India-based Java/backend roles for approximately two years of experience, reports full portal coverage, and suppresses only jobs that were successfully delivered.

The workbook contains 200 rows. The generic LinkedIn search row is intentionally excluded, leaving 199 official company or company-authorized ATS portals.

## Retrieval pipeline

Each run performs:

1. Workbook loading and official-portal policy validation.
2. ATS detection for Workday, Greenhouse, Lever, SmartRecruiters, Eightfold, SuccessFactors, Oracle Recruiting, Taleo, iCIMS, Phenom, and custom sites.
3. Public API retrieval with pagination for Workday, Greenhouse, Lever, and SmartRecruiters.
4. HTML/JSON-LD extraction and a single reusable Chromium context as fallback.
5. Official-link validation, detail parsing, profile filtering, stable-key deduplication, state restoration, and notification.
6. Per-company JSON/CSV coverage, rejection totals, slowest portals, and a GitHub Actions summary.

Portal status has a strict meaning:

- `working`: jobs and all selected details were retrieved with complete observed pagination.
- `partially working`: jobs were found, but detail parsing, pagination, or an upstream request was incomplete.
- `empty`: an authoritative supported API successfully confirmed zero results.
- `unsupported`: the portal loaded but no reliable listing extraction was available.
- `blocked`: access controls, rate limiting, consent/captcha behavior, or HTTP 401/403/429 prevented retrieval.
- `broken`: invalid/DNS-failing URLs, HTTP errors, timeouts, or adapter failures prevented reliable retrieval.

An unsupported, blocked, or broken portal is never silently treated as having no jobs.

## Profile filter

The matcher targets Software Engineer I/II, SDE-1/2, Java/backend, application, and platform roles in India, Hyderabad, Bengaluru/Bangalore, Chennai, Pune, Gurugram/Gurgaon, Noida, Mumbai, or explicitly remote-from-India. Experience overlapping 1-4 years is preferred; suitable roles with no stated experience remain eligible.

At least one requested stack signal is required, but not every skill: Java, Spring Boot, Hibernate/JPA, Kafka, microservices, REST, MongoDB, SQL, Docker, Kubernetes/OpenShift, Jenkins/CI/CD, Grafana, or Splunk.

Every rejection has a structured reason code such as `TITLE_NOT_TARGET`, `LOCATION_OUTSIDE_TARGET`, `SENIORITY_EXCLUDED`, `EXPERIENCE_TOO_HIGH`, or `SKILL_SIGNAL_MISSING`. Clearly senior leadership, staff/principal/architect/manager, level III/IV, frontend/mobile/test/firmware/embedded/ML, SRE/Rust, React Native, C++, and validation/support roles are excluded.

## Reliability and state

- Global concurrency is bounded, with separate per-domain, detail, and browser limits.
- HTTP 408/425/429/5xx and transient network failures use exponential backoff with jitter.
- Connections use Node's pooled `fetch`; one browser and context are reused and restarted after a crash.
- API adapters run before browser fallback; an adapter failure falls through safely.
- Listing/detail caps and incomplete pagination are reported rather than hidden.
- Stable identity is `company + official job ID`, falling back to `company + canonical application URL`; title alone is never used.
- `data/state.json` is schema-versioned, written atomically, and recovers a corrupt file to a timestamped backup.
- A cache miss is visible and cannot suppress jobs.
- Jobs are added to state only after at least one configured notification channel succeeds.
- Failed scans and failed notifications do not overwrite a good ledger.

## Notifications and artifacts

New matches create one GitHub Issue through `GITHUB_TOKEN`; SMTP email is optional. No notification is sent when there are no new matches. Secrets are read only from environment variables and are never written to logs, reports, or summaries.

Every run uploads `portal-coverage-<run id>` containing:

- `reports/coverage.json`
- `reports/coverage.csv`
- `logs/last-errors.json`
- `data/run-result.json`

New-match HTML and Markdown reports are uploaded separately. The workflow summary shows status totals, discovery/parsing/filtering counts, rejection reasons, state recovery, and the slowest portals.

## GitHub Actions

The schedule remains `17 */4 * * *` on `ubuntu-latest`, with a 55-minute job timeout and overlap protection. State cache keys are branch-scoped and schema-versioned.

Enable repository Issues and allow the workflow's `issues: write` permission. Optional SMTP secrets are:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`
- `SMTP_USER`, `SMTP_PASS`
- `MAIL_FROM`, `MAIL_TO`

Do not commit an `.env` file or credentials.

## Local verification

```powershell
npm.cmd ci
npm.cmd test
npm.cmd audit --omit=dev
npm.cmd run inspect:workbook
npm.cmd run diagnose
node src/index.js --dry-run --company NVIDIA
```

Dry runs generate coverage but never notify or update duplicate state. The full live diagnostic is intentionally bounded but still contacts official career sites; use deterministic mocked tests for routine development.

The production audit and latest controlled metrics are in `AUDIT.md`. Live reports are generated under `reports/` and intentionally gitignored.

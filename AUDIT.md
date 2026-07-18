# Production Audit — Official Career Job Monitor

Audit date: 18 July 2026 (Asia/Kolkata)

Workbook: `Final_Global_Software_Companies_Job_Portals.xlsx`
Scope: 200 rows; 199 official/company-authorized portals attempted; generic LinkedIn search excluded.

## Outcome

The original workflow could complete while retrieval was materially incomplete. The repaired diagnostic completed all 199 portals without a shared-browser failure cascade and now distinguishes retrieval failure, parsing failure, filtering, deduplication/state, and notification outcomes.

Latest controlled dry scan (`2026-07-18T03:59:48Z` to `04:15:33Z`):

| Metric | Before | After |
| --- | ---: | ---: |
| Runtime | 7m 42s | 15m 44s |
| Portals attempted/completed | 199 / 199 | 199 / 199 |
| Portals with candidates | 42 | 74 working or partial |
| Jobs discovered before profile filtering | 239 | 2,039 |
| Job details successfully parsed | Not measured | 1,742 |
| Accepted / rejected | 18 / not measured | 8 / 2,031 |
| Explicit portal errors | 5 (many errors hidden as zero) | 25 blocked + 14 broken |
| Unsupported portals | Not measured; counted as zero | 86 explicit |
| Confirmed authoritative API empties | Not distinguishable | 0 |

Discovery increased by 1,800 jobs (8.53×). The after-scan accepted fewer jobs because false positives were repaired rather than because filtering was removed. The 8 matches came from Google (3), NVIDIA, Expedia Group, Autodesk, Celonis, and Applied Materials. Sixty-eight working/partial portals had discovered jobs but zero accepted matches, which is the evidence-backed “jobs found but filtered out / no current profile match” category.

## Root causes and evidence

1. Only Workday had an API adapter, and it requested only the first 20 results for three searches. No ATS recorded total counts or pagination. NVIDIA increased from 4 candidates to 110 across six Workday API pages.
2. Greenhouse, Lever, SmartRecruiters, Eightfold, SuccessFactors, Oracle Recruiting, Taleo, iCIMS, Phenom, and custom portals were treated as generic HTML. Added API adapters produced, for example, Freshworks 126, Grafana Labs 114, Razorpay 23, and Druva 29.
3. HTTP failures were swallowed and changed into `{ jobs: [] }`. The baseline therefore mislabeled blocked, DNS-failing, 404, and JavaScript-only pages as empty.
4. The shared browser could close under concurrent page creation. Historical full attempts cascaded into `Target page/context/browser has been closed` errors around companies 37-47. Browser work is now bounded to one reusable context with restart-on-crash.
5. Generic extraction capped candidates/details at 20 without reporting the cap. All methods now report pages, observed totals, completion, and caps.
6. Google relative URLs became `/jobs/results/jobs/results/...`, causing detail failures. Canonical URL resolution now repairs the repeated segment and the live probe parsed 20/20 details.
7. Generic extraction accepted aggregator links embedded on official sites. A Chargebee result pointed to LinkedIn. Job URLs now must remain on the company site or an authorized ATS; LinkedIn/Indeed/Naukri/Glassdoor/Monster are rejected.
8. Filtering admitted test, lead, level III, C++, SRE/Rust, React Native, and validation/support false positives. Structured reason codes and expanded specialization/level rules fixed these while preserving suitable experience-unspecified roles and one-or-more skill matching.
9. Duplicate identity used a canonical URL alone and did not always include company or official ID. State now uses company plus official ID/application URL, removes tracking parameters, and never uses title alone when an official identity exists.
10. State version 1 aborted on corruption and cache misses were invisible. Version 2 adds validation, corruption backup/recovery, atomic writes, explicit cache-miss telemetry, and schema/branch-scoped Actions cache keys.
11. The workflow summary exposed only companies, matches, and a portal-error count. It now publishes coverage status, discovery/parsing/filter counts, rejection reasons, slow portals, state notices, and always uploads JSON/CSV diagnostics.

## Implemented fixes

- Public paginated Workday, Greenhouse, Lever, and SmartRecruiters adapters.
- Detection for every requested ATS family, with proprietary systems labeled accurately when no reliable adapter succeeds.
- Retrying HTTP client with exponential backoff/jitter and per-domain concurrency.
- Reused/restartable Chromium browser and context; browser concurrency bounded separately.
- API-first retrieval, dynamic fallback, redirected/relative link handling, official-link enforcement, and detail telemetry.
- Six-state portal classification and company-by-company coverage JSON/CSV.
- Structured filter reason codes and corrected seniority, level, specialization, location, experience, and skill rules.
- Versioned/recoverable/atomic state and stable company-scoped identities.
- Notification-before-state ordering, failure-safe run result, and cache-key versioning.
- GitHub Actions summary and always-uploaded coverage artifact; four-hour cron and `ubuntu-latest` preserved.

## Remaining blocked portals (25)

Microsoft, Meta, PayPal, UBS, Fidelity Investments, Confluent, MongoDB, Akamai, Zepto, Nykaa, Target, HashiCorp, Dropbox, S&P Global, Optum, Pinterest, Box, Adyen, Revolut, SoFi, CME Group, NatWest Group, Hitachi, bp, and McKinsey & Company.

These were blocked by explicit 403/429 responses or rendered access-control/consent pages. They must not be interpreted as having no jobs.

## Remaining broken portals (14)

BNY, Broadcom, Dream11, Games24x7, Urban Company, Netflix, Nielsen, Wolters Kluwer, TikTok, Sabre, Robinhood, Checkout.com, Discover, and Schneider Electric.

The report records the exact reason per company. Several workbook URLs now return 404 or fail DNS and should be corrected at the source; Dream11 contains a stale Lever reference whose API returns 404, after which browser fallback also found nothing reliable.

## Remaining unsupported portals (86)

Apple, Adobe, Atlassian, Walmart Global Tech, Flipkart, Samsung, Oracle, SAP, Myntra, JPMorganChase, Goldman Sachs, Morgan Stanley, American Express, HSBC, Deutsche Bank, Bank of America, Juspay, Groww, CRED, PayU, Fiserv, FIS, Databricks, Cloudflare, Rubrik, CrowdStrike, Okta, Zscaler, Zoho, BrowserStack, Postman, Chargebee, Whatfix, GitLab, Elastic, Swiggy, Zomato, ShareChat, Ola, MakeMyTrip, Cleartrip, ThoughtSpot, Cohesity, Dell Technologies, Intel, Bosch, Tesco, Spotify, Datadog, HubSpot, Bloomberg, Thomson Reuters, Texas Instruments, ByteDance, Snap Inc., Discord, Notion, monday.com, Shopify, eBay, Etsy, GoTo Group, Amadeus, Klarna, Worldpay, Western Union, MSCI, FactSet, Morningstar, London Stock Exchange Group, Standard Chartered, BNP Paribas, Northern Trust, Mercedes-Benz, Volvo Group, BMW Group, Toyota Connected, Continental, Honeywell, Panasonic, Sony, AstraZeneca, Shell, ExxonMobil, Chevron, and PepsiCo.

“Unsupported” means the portal loaded but this run could not establish trustworthy listing extraction. It is intentionally not “empty.” Highest-value next adapter work is Eightfold, Phenom, Oracle Recruiting, SuccessFactors, and iCIMS, followed by company-specific JSON endpoints for large custom portals.

## Tests and validation

- `npm test`: 33 passed, 0 failed.
- Deterministic mocked coverage: all four supported API adapters, pagination, relative/redirected URLs, Google repeated-path regression, dynamic fallback, stale-adapter fallback, partial portal isolation, timeout/retry, structured filtering, official-link policy, two-run deduplication, cache miss/corrupt state, notification failure, and ATS detection.
- Syntax checks: all `src/` and `test/` JavaScript passed `node --check`.
- Workbook inspection: 200 loaded, 199 allowed.
- Dependency audit: 0 vulnerabilities.
- GitHub Actions workflow lint: passed with actionlint.
- Full live dry scan: completed 199/199; no notification and no state mutation.
- GitHub summary rendering: passed locally with totals, reason codes, slowest portals, and outputs.

## Runtime and deployment estimate

The final local scan took 944 seconds (15m 44s). Allowing roughly 2-5 minutes for checkout, npm install, and Chromium/system dependency setup plus network variance, expected `ubuntu-latest` runtime is approximately 18-30 minutes.

## GitHub Free optimization addendum (2026-07-18)

The production schedule now preserves a run every four hours but performs one full scan at `00:17 UTC` and five browser-free fast scans at the remaining four-hour slots. The fast tier is seeded from measured non-browser successes and adapts from compact portal-health state. A controlled network-enabled fast dry run attempted 45 portals in 106.7 seconds: 23 working, 10 partially working, 12 broken, 1,151 jobs discovered, 1,095 details parsed, six accepted, four high-confidence notification candidates, and two borderline matches deferred to the daily full tier.

Fast notifications are capped at 15 and the full daily batch at 30. Overflow is stored for up to 14 days without job descriptions. Full coverage/state artifacts, match reports, and failure diagnostics now retain for seven days; normal fast coverage is kept in the workflow summary only. Chromium installation and its cache step are skipped for fast runs. Based on measured local runtimes plus Actions setup/network allowance, projected private GitHub Free usage is approximately 1,000-1,800 minutes per month rather than roughly 3,600+ minutes for six full scans per day. The job timeout is now 35 minutes.

An additional recap-only schedule runs at `17:45 UTC` (23:15 IST). Successfully delivered jobs are held in a compact `Asia/Kolkata` date bucket for at most three days, deduplicated by stable job identity, capped at 30 in the recap, and cleared only after recap delivery succeeds. This run performs no crawling or browser installation and adds only dependency setup plus notification time to the monthly Actions budget.

## Diagnostic artifacts

- `reports/coverage.json` — complete machine-readable company report and aggregate summary.
- `reports/coverage.csv` — the same company coverage for spreadsheet analysis.
- `logs/last-errors.json` — unsupported, blocked, and broken portals.
- `data/run-result.json` — final summary used by GitHub Actions.

These are generated runtime files and remain gitignored. The workflow uploads them for daily full scans, notification batches, and failed runs; ordinary successful fast scans use the GitHub summary only.

## Exact source files changed

- `.env.example`
- `.github/workflows/job-monitor.yml`
- `AUDIT.md`
- `README.md`
- `package.json`
- `src/action-summary.js`
- `src/adapters.js`
- `src/config.js`
- `src/coverage.js`
- `src/crawler.js`
- `src/digest.js`
- `src/http-client.js`
- `src/index.js`
- `src/job-utils.js`
- `src/matcher.js`
- `src/notification-queue.js`
- `src/notify.js`
- `src/platform.js`
- `src/run-mode.js`
- `src/state.js`
- `test/adapters.test.js`
- `test/coverage.test.js`
- `test/crawler.test.js`
- `test/http-client.test.js`
- `test/matcher.test.js`
- `test/notification-queue.test.js`
- `test/notify.test.js`
- `test/platform.test.js`
- `test/run-mode.test.js`
- `test/state.test.js`

No workbook, secrets, or GitHub credentials were modified. Validated changes are published on the `version-1` branch.

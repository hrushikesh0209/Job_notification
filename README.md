# Official Career Job Monitor

A four-hourly GitHub Actions monitor for the company career links in `Final_Global_Software_Companies_Job_Portals.xlsx`. It searches for India-based Java/backend roles suitable for approximately two years of experience, suppresses duplicate notifications, and stays silent when nothing new qualifies.

The workbook currently contains 200 rows. The generic `linkedin.com/jobs/search` row is intentionally skipped because it is an aggregator search rather than LinkedIn's company-specific career portal, leaving 199 official company portal checks. Company-authorized ATS hosts such as Workday remain allowed.

## What it matches

- Software Engineer I/II, SDE-1/2, backend or Java engineer/developer, Application Developer, and Platform Engineer roles.
- India, Hyderabad, Bengaluru/Bangalore, Chennai, Pune, Gurugram/Gurgaon, Noida, Mumbai, and remote roles explicitly available from India.
- Experience requirements overlapping 1–4 years, plus roles where experience is not specified.
- Senior roles only when they are explicitly backend-focused and state a compatible experience requirement.
- At least one relevant skill such as Java, Spring Boot, JPA, Hibernate, Kafka, microservices, REST APIs, MongoDB, SQL, Docker, Kubernetes, Jenkins, Grafana, or Splunk.

It rejects staff, principal, architect, manager, director, lead, leadership, clearly unrelated specialization, explicit 5+ year, and higher numbered Software Engineer III/IV roles.

## How notifications work

When new matching jobs are found, the workflow:

1. Creates one GitHub Issue containing company, title, location, posting date, required experience, relevant skills, match explanation, and the direct official application link.
2. Uploads complete HTML and Markdown reports as a workflow artifact.
3. Optionally sends the same report by SMTP email when email secrets are configured.
4. Saves the successfully notified job IDs in the Actions cache so later runs do not repeat them.

No Issue, email, or report artifact is created when there are no new relevant jobs. If every configured notification channel fails, the run fails and does not mark those jobs as notified.

## GitHub setup

1. Create a GitHub repository and add this entire folder, including the workbook and `.github/workflows/job-monitor.yml`.
2. Make sure repository **Issues** are enabled under **Settings → General → Features**.
3. Make sure GitHub Actions is enabled. Organization policy must allow the workflow's `issues: write` permission.
4. Commit and push the workflow to the repository's default branch. Scheduled workflows only run from the default branch.
5. Open **Actions → Four-Hourly Official Career Job Monitor → Run workflow** for the first test.

The schedule is `17 */4 * * *`: every four hours at minute 17, starting at 00:17 UTC. In India, the expected daily run times are approximately 01:47, 05:47, 09:47, 13:47, 17:47, and 21:47 IST. GitHub can delay scheduled runs during periods of high load.

The first successful run starts with an empty ledger and can report currently open matching jobs. Later runs report only newly detected matches.

## Optional email secrets

GitHub Issues require no custom secret; the workflow uses the repository's temporary `GITHUB_TOKEN`. Email is optional. Add these under **Settings → Secrets and variables → Actions**:

| Secret | Description |
| --- | --- |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | Usually `587` for STARTTLS or `465` for implicit TLS |
| `SMTP_SECURE` | `true` for implicit TLS; otherwise `false` |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password or app password |
| `MAIL_FROM` | Sender address |
| `MAIL_TO` | Recipient address |

If no SMTP secrets are supplied, GitHub Issue notification remains active.

## State and duplicate suppression

`data/state.json` stores hashes of jobs that were successfully reported. The workflow restores the newest state through an `actions/cache` prefix and saves a new immutable cache entry after each successful run. Workflow concurrency prevents overlapping scans from racing on state.

GitHub cache is practical but not permanent storage. Regular scheduled use keeps it warm; if all caches are deleted or expire, currently open matching jobs may be reported once again. A dedicated state branch or external database can be added later if permanent history is required.

## Local validation

Local commands do not install a scheduler:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd audit --omit=dev
npm.cmd run inspect:workbook
node src/index.js --dry-run --company NVIDIA
node src/index.js --dry-run --company Google
```

Dry runs do not update duplicate state or send notifications. A normal local `npm run monitor` only writes reports unless SMTP or GitHub integration environment variables are supplied; the production deployment is GitHub Actions.

## Runtime files

- `src/crawler.js` — Workday API plus HTML/Chromium portal extraction.
- `src/matcher.js` — profile matching and experience rules.
- `src/notify.js` — GitHub Issue, report, and optional email delivery.
- `src/state.js` — stable duplicate keys and ledger.
- `logs/monitor.log` — per-company progress inside a workflow run.
- `logs/last-errors.json` — portals that could not be checked in the latest run.
- `reports/latest.html` and `reports/latest.md` — generated only for a new-match batch.

Career sites change and some use anti-automation controls. A portal showing zero candidates may require a future dedicated adapter; portal failures are logged without creating false job notifications.

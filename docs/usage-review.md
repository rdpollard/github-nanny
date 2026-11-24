# Hosting usage review

## Measured D1 usage — November 24, 2026

A read-only `wrangler d1 info github-nanny --json` inspection reported:

| Metric | Observed value | Current Workers Free allowance |
| --- | ---: | ---: |
| Rows read, last 24 hours | 129,294 | 5,000,000 per day |
| Rows written, last 24 hours | 23,983 | 100,000 per day |
| Database storage | 139,264 bytes (136 KiB) | 5 GB total across the account |
| Read queries, last 24 hours | 19,754 | Billing uses rows, not query count |
| Write queries, last 24 hours | 5,817 | Billing uses rows, not query count |

Read and write row volume is roughly 2.6% and 24% of the respective daily free
allowances. The report is a rolling 24-hour snapshot; free daily usage resets
at 00:00 UTC, so these are scale comparisons, not exact quota consumption.
Allowances are account-wide and other databases can consume them. This snapshot
includes real setup/development traffic and does not predict every future day.

The measured D1 load alone does not justify a paid plan. No paid resource or
upgrade has been enabled by this review.

## Worker and GitHub workload

A normal four-repository complete scan uses 34 GitHub requests. A minute schedule
means up to 1,440 checks/day and approximately 48,960 outbound GitHub requests/day
if every check runs normally. They are distributed across two installations;
this is a workload estimate, not a measured GitHub rate-limit balance. Failures,
backoff, pagination and runtime overlap change the actual total.

The public dashboard refreshes status from D1 every 30 seconds while open; one
continuously open tab can generate about 2,880 status requests/day. That spends
no GitHub requests. At most four outbound push deliveries follow one successful
scheduled scan, only when eligible alert work exists. Static asset requests are
free under the cited Workers pricing. Outbound subrequests are not themselves
billed as additional inbound Worker requests.

Current Workers Free pricing includes 100,000 requests/day and 10 ms CPU per
invocation. Network wait time is not CPU time: a scan lasting seconds does not
establish its CPU cost. The Paid plan starts at $5/account/month; do not upgrade
without actual evidence and owner authorization.

## Owner dashboard measurements — November 24, 2026

The owner supplied production and account screenshots:

| View/window | Measurement |
| --- | --- |
| Worker overview, last 24 hours | About 2.18k invocations; 0 errors |
| CPU detail, last 24 hours, all deployed versions | P50 35.84 ms; P90 61.39 ms; P99 73.73 ms; P999 74.11 ms |
| Account usage, Today | 1,695 / 100,000 requests (about 1.7%) |
| Account observability, Today | 11 / 200,000 events |

The account allowances correspond to Workers Free. The Today and last-24-hour
views are different windows and the overview counters are rounded. The screenshot
was not a complete billing/invoice review. CPU percentiles are per invocation,
not total billable CPU or an average; this view includes historical deployments
and does not isolate scheduled invocations. The current-version CPU tail cannot
be derived from this aggregate screenshot.

The request, observability and measured D1 volumes do not justify upgrading.
Recommend retaining the current free plan while checking CPU compatibility.
No upgrade or paid resource has been authorized or enabled by this review.

## CPU follow-up

Cloudflare documents a 10 ms Free CPU limit for HTTP and Cron invocations, with
some isolate flexibility for occasional overruns. The observed aggregate CPU
percentiles exceed that documented budget, despite zero observed errors. Do not
interpret absence of errors as a guaranteed CPU allowance or claim the workload
is indefinitely safe on Free. Current-version scheduled CPU profiling/measurement
is the remaining engineering follow-up; optimize demonstrated hot paths before
considering a paid plan. Any subscription change still requires owner approval.

Requests and D1 writes should also be assessed over ordinary days as the scope
or number of open dashboards grows. No recurring engineering CI status watcher
or new account automation is installed by this review.

## Sources checked November 24, 2026

- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/#cpu-time

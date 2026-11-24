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

## Remaining account-dashboard check

The available Wrangler D1 metadata supplied the measurements above. Current
Worker invocation totals, CPU distributions, CPU-limit errors, account-wide
consumption and the billing page were not retrieved, so a complete $0 hosting
conclusion is not yet verified.

In Cloudflare, open Workers & Pages → github-nanny → Metrics/Observability and
check a representative day: requests, CPU time (including scheduled checks),
errors/exceeded-resource outcomes, and account usage. Also review D1 writes over
several ordinary days; writes have less headroom than reads in this snapshot.
Do not infer scheduled CPU behavior solely from HTTP request metrics. Share
aggregate usage figures only, not token or subscription values. Reconsider cost
only if measured limits, errors or scope growth call for it.

## Sources checked November 24, 2026

- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/platform/pricing/

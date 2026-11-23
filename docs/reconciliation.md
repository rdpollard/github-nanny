# Automatic Actions checks

Continuous checks are deployed and owner-activated. The owner verified the
public idle dashboard across four repositories, and a real signed completed
workflow event is verified.
Web Push and production idle-outbox creation remain disabled.

## Activation after deployment

1. Confirm the shared webhook secret and Workflow run/Repository subscriptions
   described in webhooks.md. Verify an ordinary CI run creates accepted signed
   delivery receipts in hosted D1. A 401 from an unsigned probe proves only that
   the receiver is configured; it does not prove both services share a secret.
2. Sign in at `/settings`. Verify the saved scope still contains only the four
   intended public repositories. Click **Start automatic checks**.
3. Start repeats full installation discovery and requires the public repository
   IDs, names, account IDs and installation IDs to match the saved scope. Access
   changes require **Save public scope** before starting. Caller data cannot
   select repositories. A fresh scope generation clears old confidence/activity.
4. After Cloudflare has propagated the deployed schedule, the first check starts
   on a scheduled wake-up, normally within a minute. Initial schedule propagation
   can delay checks after deployment.
   Open the public dashboard. Busy lists unfinished runs and attempts; idle
   requires two complete empty observations with a quiet interval. Initial quiet
   creates no idle epoch or notification. Waiting/approval states block idle.
5. Verify a normal run in both personal and organization coverage, its run link,
   and the eventual idle state. No workflows are dispatched by this monitor.

**Pause automatic checks** disables scans, hides results, advances the scope
revision, cancels leases/pending notices and clears activity confidence. It keeps
the saved public inventory, sign-in and App installation. Starting again repeats
access verification. Saving/disconnecting scope also pauses checks atomically.
A pause defeats a concurrent Start still verifying the preceding generation.

## Runtime and data flow

Cloudflare Cron (`* * * * *`, UTC) calls the scheduled Worker handler. It reads
the current server-configured scope and claims an enabled, due D1 lease. One
successful claim reserves the next normal attempt for the next minute boundary,
so scheduler jitter does not skip an otherwise healthy check. Concurrent
or duplicate wake-ups do not spend GitHub requests. Leases expire after 45
seconds; expired/replaced leases cannot commit scan success or failure. Scope
and monitor revisions separately reject access changes and fresh signed activity
that arrive during a scan. A later wake-up can recover a crashed worker.

Each scan reuses the complete bounded manual-check pipeline: full discovery,
public metadata before/after run queries, all pages of all five unfinished
statuses, a shared 40-request budget, a 25-second provider deadline, per-request
timeouts and response/document bounds. No partial scan becomes idle. The quiet
candidate needs a second empty scan that starts at least 10 seconds after the
first finishes, within a 120-second candidate lifetime. Normal idle confirmation
is roughly one to two minutes after activity ends, plus scheduling/network delay.
Once confirmed, continuing successful empty scans preserve idle. A genuine gap
of more than 120 seconds since the latest complete check requires another pair
of confirming empty scans; elapsed time spent idle alone does not.

Failures hide current data and back off from one minute to a maximum fifteen
minutes. Valid GitHub Retry-After/rate-reset timestamps can extend the delay.
The next complete successful scan clears the failure. A revision conflict waits
until the next normal opportunity rather than treating it as a provider outage.
Logs contain fixed event/outcome names, never raw provider errors or tokens.

The public `/api/status` endpoint reads only D1, never GitHub. A joined read
requires the current prepared scope, enabled control and matching monitor
revision. Results older than 95 seconds, outstanding leases (including a crashed
lease), failures, incomplete quiet confirmation or storage/configuration errors
produce unknown status with no cached run details. All responses are no-store.
Only whitelisted run fields and canonical GitHub attempt links are returned.
The PWA refreshes saved results every 30 seconds; unknown/offline/error views
hide run lists and count values. Dashboard filters cannot affect monitoring.

Snapshots describe the last complete check. GitHub reads are distributed rather
than an atomic account snapshot; no check guarantees future activity will remain
absent. Signed visibility/coverage events invalidate confidence promptly; every
scan rechecks visibility, and freshness expiry bounds missed-event staleness.

## Usage and release verification

For the current four repositories, a normal complete scan uses 34 GitHub API
requests: six discovery, twenty status queries and eight metadata requests.
At one scan/minute this is about 2,040/hour total, split across two installation
rate limits. Pagination can exhaust the bounded budget; that fails unknown
rather than truncating coverage. Public visitors add no GitHub API requests.
Actual Worker CPU, D1 usage and installation rate headroom must be measured
before enabling automatic releases or growing scope; no paid plan is enabled
by this change. Scheduled calls still wake while paused, but perform no scan.

Migration 0005 adds one disabled control row. CI must pass before applying it
remotely and uploading code. A rollback to the previous receiver preserves the
additive schema and stops scheduled scanning; remove/pause the Cron Trigger if
needed. Do not enable `CLOUDFLARE_DEPLOY_ENABLED` as part of this milestone.

Focused tests use real workerd/D1 and the built scheduled entry to cover duplicate
triggers, complete scans, quiet confirmation, private exclusion, staleness,
backoff, lease expiry/takeover, pause/in-flight races, scope changes, owner auth
and CSRF. Browser smoke exercises Start/Pause, scope changes and unknown views.
The engineering CI handoff remains separate: share one run link, then wait for
the user's completion message. Product reconciliation never resumes Codex or
creates a CI status watcher.

References:
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/

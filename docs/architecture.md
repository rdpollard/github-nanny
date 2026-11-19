# Architecture

## Target design

```mermaid
flowchart LR
  GH[GitHub App] -->|Signed webhooks| API[Cloudflare Worker]
  CRON[Scheduled reconciliation] --> API
  API -->|Paged REST queries| GH
  API --> DB[(D1)]
  UI[Public PWA] -->|Read-only status API| API
  API -->|Web Push| DEVICE[Subscribed devices]
  CICD[GitHub Actions] -->|Build and deploy| API
```

The current implementation contains the PWA shell, honest unknown-status API,
and a pure idle-decision function. D1, scheduled handlers, authorization, webhooks,
and push delivery are planned, not active. See roadmap.md for boundaries.

## Frontend and framework choice

Use React + TypeScript + Tailwind with Vite and the Cloudflare Vite plugin.
Selected MIT components from the upstream Next.js dashboard work as ordinary
React components; their interface does not require Next.js rendering or routing.
Vite avoids bringing the upstream's duplicate Next.js config and browser token
management into the new project. One Worker serves static assets and `/api/*`.

The demo is frontend-only and explicitly selected by `?demo=1`; it cannot affect
backend monitoring or dispatch notifications. User filters affect rendering only.
The service worker caches only an offline document; status and authenticated
requests are not cached. Cross-device install and push checks remain required.

## GitHub access and coverage

Register a GitHub App with Actions: read and mandatory Metadata: read. Subscribe
to workflow run/job events plus installation and repository lifecycle changes
needed to maintain coverage. Request no content, administration, or Actions
write access. Validate actual event action types with a sandbox repository.

Use GitHub user authorization for the owner session. An owner allowlist compares
the returned immutable GitHub user ID to configuration. Installation access is
separate: install on all repositories owned by the personal account and add
organization installations as authorized. Reconcile repository membership using
all pages. Do not equate a user's accessible repos to one installation's repos.
Define and display any needed polling coverage for collaborator repositories.

App private keys, webhook secret, OAuth client secret, and Web Push private key
belong in Worker secrets. Persist user/refresh tokens only with server-side
encryption and a secret-held key. Installation tokens are short-lived and renewed
as needed. The read-only public status endpoint returns no credentials, user
email, subscription endpoints, or private repository details.

## Idle decision and races

`worker/monitor.ts` contains a pure decision function with four state fields:
phase, activityObserved, revision, and idleEpoch. It does not call GitHub, commit
state, or send push itself.

Fresh activity increments the revision and arms a future notice. Start a scan
with that revision; query the entire monitoring scope using complete pagination
and explicit nonterminal status handling. No latest-N shortcut is sufficient.
Accept a zero-active result only if every query succeeded and the revision is
still current. A new webhook during the scan invalidates its result. Repeat
reconciliation after a brief stabilization interval to accommodate chained
workflows and delayed events before launch. No distributed scan can guarantee
that GitHub will not start a new run immediately afterward.

The future persistence layer must atomically compare-and-swap the revision,
update monitor state, and enqueue an outbox notice with unique idleEpoch in a D1
transaction/batch. This prevents two Workers from creating separate notices for
the same transition. Webhook delivery IDs need a unique constraint. Attempts and
out-of-order events must not reopen a completed run incorrectly.

Push delivery consumes the outbox with per-device delivery tracking and retry
backoff. A notice is not marked sent before a push service accepts it. An ambiguous
network failure can duplicate delivery; use a stable notification tag per epoch
to reduce duplicates. Expired subscriptions are removed. Do not promise exact
once display on all devices.

## Planned persistent data

| Record | Purpose |
| --- | --- |
| Account/installations | Allowed owner ID, installation IDs, coverage health |
| Repositories | Scope, visibility, access state, successful discovery time |
| Runs/attempts | Every unfinished run, status, run URL, event ordering metadata |
| Webhook deliveries | Idempotency and processing result with bounded retention |
| Monitor state | Phase, revision, activity latch, epoch, last complete scan |
| Push subscriptions | Private endpoint and keys for each authorized device |
| Notification outbox | Stable epoch, relevant completed-run links, retry state |

Internal short retention for notice links/deduplication does not imply a history
view. Avoid retaining workflow logs or full webhook payloads unnecessarily.

## Reconciliation and API budget

Webhooks give prompt evidence; scheduled scans repair missed activity and refresh
scope. Use a hosted scheduler, not a GitHub Actions polling workflow: running a
monitoring workflow itself creates activity and can interfere with global idle.
Include github-nanny's ordinary CI/deployment runs in monitoring once installed.

Choose cadence after measuring repository count. A scan of N repositories with S
separate status queries costs at least N*S API requests before pagination. At one
scan/minute, that is 60*N*S/hour; for 20 repos and two statuses, 2,400/hour before
other API work. Job events can be numerous. Coalesce overlapping scans, bound
concurrency, honor rate-limit headers, and back off. If a scan exceeds Worker
subrequest/CPU limits, split work into batches and publish a result only when
the complete scan generation finishes. Unknown is preferable to false idle.

## Sources

- https://developers.cloudflare.com/workers/framework-guides/web-apps/react/
- https://developers.cloudflare.com/workers/vite-plugin/tutorial/
- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://docs.github.com/en/rest/actions/workflow-runs
- https://docs.github.com/en/webhooks/webhook-events-and-payloads
- https://docs.github.com/en/apps/using-github-apps/authorizing-github-apps

# Signed GitHub event receiver

The receiver is deployed. After the initial real delivery failed signature
validation, the owner rotated the shared secret in Cloudflare and GitHub.
Redelivery returned 202 and hosted D1 independently confirmed the delivery ID
and completed terminal run/attempt. Real signature validation and persistence
are verified. Automatic checks remain paused pending owner activation; Web Push
remains a separate milestone. The instructions below are retained for setup
and future rotations.

## Owner setup after deployment

1. Generate a random secret in a password manager. A 64-character random hex
   value is suitable. The receiver accepts 32–256 characters. Save it securely
   so you can enter the identical value in both services; keep it out of chat,
   source, command history and browser storage belonging to this app.
2. In the existing Cloudflare Worker's **Settings → Variables and Secrets**,
   add a **Secret** named `GITHUB_WEBHOOK_SECRET` and deploy the secret:
   https://dash.cloudflare.com/30d2f3da9cdc70736e8a39392f4dc43c/workers/services/view/github-nanny/production/settings
   Preserve the existing secrets. This is separate from SESSION_SECRET,
   GITHUB_CLIENT_SECRET and the App private key.
3. Open https://github.com/settings/apps/gh-nanny. Under **Webhooks**, set:
   - Webhook URL: `https://github-nanny.github-nanny.workers.dev/api/webhooks/github`
   - Secret: the same generated value.
   - Active: enabled after the Worker secret is deployed.
4. Under **Permissions & events → Subscribe to events**, subscribe to
   **Workflow run** and **Repository**. Keep Actions and Metadata read-only.
   Installation and installation-repositories events are automatic App events.
   No additional repository write permission or OAuth callback change is needed.
5. Save the GitHub App settings. In **Advanced → Recent deliveries**, verify
   the signed ping returns 200. A recognized workflow/coverage delivery normally
   returns 202. If a coverage change clears saved scope, use **Save public scope**
   in Nanny's settings to perform a new verification.
6. During the next ordinary workflow run, verify signed activity reaches the
   receiver. Report the delivery status/result; do not copy raw payloads or
   secrets into chat. Real delivery verification remains necessary even though
   the local runtime tests sign and verify payloads independently.

The existing sign-in Redirect URI continues to serve GitHub owner authorization.
The Webhook URL above belongs in the separate Webhooks section.

## Authentication and scope

POST is required. The receiver rejects missing setup with 503, invalid signatures
with 401, malformed headers/payloads with 400, non-JSON media types with 415 and
payloads over 1 MiB with 413. It verifies X-Hub-Signature-256 over the exact raw
UTF-8 bytes using Web Crypto HMAC SHA-256 before parsing or storage. Legacy SHA-1
signatures are insufficient. X-GitHub-Delivery must be a GUID. No owner cookie is
needed: the dedicated signature authenticates this service callback.

Only server-configured, saved public repositories and matching installation and
owner IDs are accepted. Unrelated installations and private repositories do not
write receipts, run state or activity. A monitored public repository becoming
private is a coverage loss and clears saved scope; its private activity is not
counted. Responses contain fixed acknowledgements/errors, not account or run
data. Raw bodies, signatures, secret values, profile/commit fields and supplied
URLs are neither logged nor persisted.

## Ordering and idle safety

- Accept workflow_run requested, in_progress and completed actions. Requested
  does not fire for reruns, so the other actions and attempt number are essential.
- All queued, in_progress, requested, waiting and pending states are unfinished.
  Completed conclusions count as terminal regardless of success/failure/cancel.
- Duplicate delivery IDs cannot write twice, including after a scope reset.
  Repeated identical evidence with a new ID cannot rearm activity either.
- Higher attempts replace older attempts. Completion is absorbing within an
  attempt, and a late old completion cannot close a newer rerun.
- Fresh activity invalidates scan revisions, clears the quiet candidate and
  cached run document, and cancels an unsent old idle notice. No event asserts idle.
- REST observations track covered attempts. A delayed completion already covered
  by a stabilized idle observation cannot produce a second activity period.
  Previously unseen fast runs still arm a new check. A stale REST result cannot
  reopen an attempt already completed by a signed event.
- Installation suspension/deletion/permission acceptance, saved repository
  removal or personal selection narrowing, and repository deletion, privatization,
  transfer or rename invalidate scope. They require fresh owner verification.
- Events older than seven days, before scope verification (at second precision),
  or more than five minutes in the future are ignored. Per-event bounded cleanup
  removes expired metadata opportunistically; scheduled retention cleanup is
  still planned. Scope resets clear run-ledger state but preserve receipt IDs.

Only minimal IDs, attempt/status/timing and deduplication metadata are stored.
The receiver makes no GitHub API request and starts no timer, workflow or cron.
Notification readiness remains disabled. Public status requires deployment and
owner activation of automatic checks; see reconciliation.md. A webhook alone
cannot publish idle.

## References

- https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- https://docs.github.com/en/webhooks/webhook-events-and-payloads
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run

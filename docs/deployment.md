# Deployment status

## PWA icons automatic release

PR #20 merged as `1cb06aa2304618eef6331d73d2f1be92871a3576`.
Main CI `45477896720` and push-triggered Deploy `45477896731` both passed,
including manifest/icon browser verification. No migrations were pending.
Cloudflare version: `a02d1bce-77a3-4099-a6ab-40dbf24e1488`.

Hosted checks matched all four served PNGs byte-for-byte against committed
assets and verified dimensions, unchanged manifest identity/start/scope,
maskable entry, Apple link and PNG notification icon. Health/status returned
200, owner push/alert routes rejected unsigned requests with 401. Public status
reported four repositories, confirmed idle and alerts enabled. Read-only D1
confirmed monitoring/alerts enabled, four registrations, the activation binding,
no errors and no backoff failures. The minute schedule remains active.

This also verifies an automatic main-push release using the configured CI token.
Real launcher/install appearance, Linux desktop receipt/taps, automatic run-link
navigation on Edge/Chrome and Worker CPU/account usage remain owner checks;
asset verification and headless smoke do not establish those results.


## First GitHub Actions production deployment

The owner created an account API token with Individual Workers Editor scoped to
`github-nanny` plus D1 Write for its account, saved both Actions secrets, enabled
`CLOUDFLARE_DEPLOY_ENABLED=true`, and dispatched Deploy on main. Run
`45475925420` succeeded for `c10476eb279569f7ed0ee42ace72d5ad85c28afd`.
All credential, unit/runtime (48/61), browser, dry-run, migration, upload and
public health steps passed. No migrations were pending. Published Cloudflare
version: `b2ca37a5-3d62-40c6-a3b8-bf4e0b41ca16`; the minute schedule remains active.

Independent HTTPS probes confirmed health/status 200, tap-v2/assets present and
unsigned push/alert administration 401. Read-only D1 confirmed monitoring and
alerts enabled, four device registrations and the activation binding preserved.
The first observation caught a concurrent-activity conflict (zero failure backoff)
and unknown status. The following complete 34-request scan cleared the error
with zero failures; normal two-scan idle confirmation was then in progress.
The source gate is enabled for future main pushes; this first verification used
manual dispatch. Application secrets were not replaced or printed.


## Tap-v2 diagnostics deployment

Main CI run `45461676255` passed for merge commit
`7e335ee57822edd9e48dce25eea03ba11bd22438`. No migrations were pending.
The rebuilt Worker/assets were deployed manually as Cloudflare version
`caae730c-80b5-4be8-85e4-ccc3e8008d5b`, preserving the minute schedule.
HTTPS checks verified health/status 200, the tap-v2 service worker, Settings
with the diagnostic control, and unsigned push/alert administration 401.
Public status reported four repositories, confirmed idle and alerts enabled.
Hosted D1 confirmed monitoring/alerts enabled, two devices, the activation binding
and no errors/failures. Automatic GitHub deployment remains disabled.

Actual Vivaldi taps are still unverified. On each owner device, reload Nanny,
check Settings reports handler tap-v2, send and tap a fresh test, then inspect
the latest local result if opening fails. No owner session or tap was fabricated.


## Notification click correction deployment

Main CI run `45294554162` passed for merge commit
`00ac0a5ed38294b2cf663fa1803c6df6c635f9e4`. No migrations were pending.
The rebuilt Worker/assets were deployed manually as Cloudflare version
`72eb9081-edc9-452f-a760-6e0f17c2ca3d`; the minute schedule remains active and
GitHub automatic deployment remains disabled.

Hosted HTTPS checks verified health/status 200, the app-first notification click
handler and dashboard run-link bundle, and unsigned push/alert administration
401. Read-only hosted D1 confirmed checks and alerts enabled, both registrations
preserved, the activation binding present and no backend errors/failures. Public
status reported four monitored repositories and alerts enabled. Existing busy
activity was preserved; deployment did not reset the monitoring state.

The owner must reload Nanny on both devices to receive the updated service
worker, then verify tapping opens Nanny and **View run on GitHub** opens the
attempt. Test-notification taps can first verify app opening without creating
GitHub activity. Actual Vivaldi click-through remains unverified after this fix.

## Automatic checks deployment

Main CI run `45129728193` passed for merge commit
`bb3f722b9e1ebd006b313f5aadd5d568c292c9b9`. Migration
`0005_reconciliation.sql` applied successfully to hosted D1, then the built
Worker and assets were uploaded manually as Cloudflare version
`b45111ff-fb28-4996-be1a-56bf251b119e`. Cloudflare registered the one-minute
Cron Trigger. Automatic GitHub deployment remains disabled.

HTTPS probes verified the new homepage/settings asset bundle, health 200,
uncached paused/unknown public status, configured owner sign-in, owner-only
reconciliation controls (401 unsigned) and webhook signature enforcement
(401 unsigned). No owner session or signature was fabricated. The Vite build's
redirected Wrangler configuration was used for upload; explicitly selecting the
source config bypasses its generated asset directory and cannot upload assets.

A read-only hosted query confirmed the existing four-public-repository scope at
revision 3, matching control revision, enabled=0, no active lease, notification
readiness=0 and no pending notices. Deployment alone has not started GitHub API
scans. Existing secrets and owner/scope data were preserved.

The first real delivery returned Invalid webhook signature. The owner rotated
GITHUB_WEBHOOK_SECRET in both Cloudflare and GitHub, then redelivered the
workflow_run.completed event successfully (202, ok=true). A read-only hosted
query independently confirmed delivery d2a6d488-e70d-11f1-8d5a-acd4e809b975 and
run 45129728193, attempt 1, completed/terminal. Signature authentication,
configured public scope acceptance and persistence are now verified with a real
GitHub event. The owner subsequently activated automatic checks and verified
the public dashboard showing confirmed idle across four repositories. Hosted
checks confirmed enabled=1, 34 requests per scan, no errors/failures, no active
runs and no pending notices. Notification readiness remains zero; push is not
implemented.
See [reconciliation.md](reconciliation.md) for activation and rollback.

## Steady idle correction

Post-activation verification exposed the idle candidate lifetime being reused
against the original empty observation after idle was already confirmed. That
periodically returned unknown despite consecutive successful empty checks. The
correction maintains confirmed idle using the latest complete-check time; a real
observation gap still requires fresh confirmation. Unit and real D1 regression
coverage includes ten minutes of quiet checks, outage recovery and unchanged
idle epoch/outbox count. Main CI run 45256943550 passed for merge commit
`e954d3d50f7a4df09ddc39f79094c2c2cd43d347`. The correction was deployed as
Cloudflare version `05370a37-313d-472c-9ca7-267c843fc9c2`, with the existing
minute schedule and enabled monitoring preserved. No migration was needed.
Hosted verification confirmed enabled checks with no errors or failure backoff;
notification readiness remains zero.

## Push-device deployment

Main CI run `45274694200` passed for merge commit
`bf2378162a63df00294a0396712af01b3cccc3c0`. Migration
`0006_push_devices.sql` applied successfully to hosted D1. Fresh VAPID and
storage secrets were generated into owner-only files outside the repository,
validated without printing values and imported through Wrangler stdin. Secret
metadata confirmed both new names and preservation of all existing names.

The built Worker/assets were deployed manually as Cloudflare version
`dc804f5c-41af-4b5c-b9ee-c9f414d9299c`. The minute schedule and existing enabled
monitoring were preserved. Automatic GitHub deployment remains disabled, and
no paid resources were provisioned.

HTTPS probes confirmed the current homepage/settings bundle, new service-worker
push handler, health, configured owner sign-in and uncached four-repository
status. Unsigned push settings and test requests returned 401. No owner cookie
was fabricated, no subscription was enrolled and no real test push was sent by
these probes. The live owner settings/readiness and actual background receipt
remain to be verified in the owner's browser.

Hosted D1 confirmed monitoring enabled with no errors/backoff, zero devices,
zero pending notices and notification readiness zero. Automatic idle alerts
remain disabled. The owner subsequently verified actual Windows 11 Vivaldi receipt in browser
and installed-PWA use, including tests initiated from Android. The owner clarified that Android Vivaldi also receives notifications in the
notification shade, with no foreground banner. A read-only D1
check confirmed both devices' last tests were accepted by their push service.
Windows and Android transport/display are verified; background and lock-screen
presentation remain acceptance checks. See push-devices.md.

## Automatic idle alert deployment

Main CI run `45281897321` passed for merge commit
`3a63797481cfb05d5cf97fb7af3a4072b48314cc`. Migration
`0007_idle_delivery.sql` applied successfully to hosted D1, then the built
Worker/assets were deployed as Cloudflare version
`75e791f4-9f10-435a-a239-9fea48555cf6`. Existing push secrets were reused and
both registered devices were preserved with their initial revision zero.

HTTPS probes verified the current homepage/settings bundle, idle-capable service
worker, health, configured sign-in and uncached four-repository status with
alertsEnabled=false. Unsigned GET/POST alert administration returned 401. No
owner session was fabricated or alert activation performed by these probes.

Hosted D1 confirmed checks enabled with no errors or backoff, notice_enabled=0,
no activation binding, no pending notices and no delivery rows. Automatic
GitHub deployment remains disabled; the minute schedule is preserved. The next
step was owner activation. The owner subsequently enabled alerts; a read-only
hosted query confirmed monitoring_enabled=1, notice_enabled=1, the activation
binding present, two devices and no backend errors. Initial quiet remained
silent with no pending notice/delivery. Real automatic receipt, run-link clicks
and background/lock-screen behavior remain to be verified. See idle-alerts.md
and release-checklist.md.

## Automatic receipt follow-up

After PR #17 CI, the owner confirmed automatic Vivaldi idle notifications on
both Windows and Android. Neither notification opened a destination when tapped.
The app-first click fix is in source with a dashboard run link, pending main CI,
deployment and real-device retesting. This is separate from successful delivery;
monitoring, subscriptions and push secrets do not need resetting.

## Signed webhook deployment

After main CI passed, commit `1a616ef5bfc4fa460c899e2c0ae5e97a5cffa544`
was deployed manually as Cloudflare version
`ba3d6398-6383-4558-9bd7-6519101ca2e8`. Migration
`0004_webhook_events.sql` applied successfully to hosted D1 before code upload.
Existing scope/session/monitor data and Worker secrets were preserved.
Automatic GitHub deployment remains disabled; its workflow was skipped.

HTTPS checks confirmed the receiver rejects GET with 405 and fails closed on
POST with 503 while the dedicated secret is unconfigured. Health and owner
sign-in configuration remain ready; public status remains uncached and
unknown/unconnected. No authenticated webhook was sent by these probes.
The owner must configure the shared secret and GitHub subscriptions using
webhooks.md, then verify a real signed ping and workflow delivery. Continuous
monitoring and notification delivery remain inactive.

## Signed webhook preparation

The owner verified a running `Build Skyview Dev Setup` workflow in the required
organization repository. A read-only hosted query confirmed phase busy, one
active run, armed activity, disabled notices and no pending outbox entries.
The live persistence path is verified.

The signed receiver and migration `0004_webhook_events.sql` are deployed as
recorded above. The dedicated secret remains unconfigured and the
GitHub App's webhooks remain inactive. Setup requires a dedicated shared secret
entered directly in GitHub and Cloudflare after receiver deployment. Event
ingestion does not call GitHub, schedule checks or enable notifications. The
public dashboard remains unknown/unconnected. See webhooks.md for setup.

Local validation passed: `npm run check` (38 unit tests and 37 runtime/D1
tests), browser smoke, local migration application and Wrangler deployment dry
run. Coverage includes raw UTF-8 signatures, declared/streamed size bounds,
concurrent duplicates, old completions and reruns, stale REST contradictions,
late completion accounting, private scope enforcement, coverage invalidation
and redelivery, rollback and retention. Hosted migration/deployment and real
GitHub delivery setup remain with the owner after deployment.

## Durable monitoring state deployment

After main CI passed, commit `b42c16b2cdb4e91abe8800a68a6378884dfc323c`
was deployed manually as Cloudflare version
`460beab8-4dff-4fbc-b6ba-3ba2a7deb57d`. Migration
`0003_monitor_state.sql` applied successfully to the hosted database before
Worker upload. Existing scope/session data and secrets were preserved.
Automatic deployment remains disabled; its workflow was skipped.

HTTPS checks confirmed health, configured sign-in, unchanged manual Actions UI,
401 protection on the Actions endpoint and uncached unknown/unconnected public
status. A read-only hosted query confirmed monitor and saved-scope revision 3
match, phase is unknown, notice_enabled is zero and no outbox rows are pending.
No Actions query was made by these unauthenticated probes. The owner subsequently
verified the persistence path with a running organization workflow, as recorded above.
Signed webhook ingestion, continuous monitoring and push remain inactive.

## Durable monitoring state preparation

The owner verified a live empty Actions check across all four public repositories
and confirmed requested, waiting and pending runs block idle alongside queued
and running. Live nonempty results are not yet verified.

Migration `0003_monitor_state.sql` and the durable-state change are deployed as
recorded above. Manual checks persist sanitized current-run observations and
internal stabilization state. Scope save/disconnect atomically clear that state
and pending notices. Notification creation defaults off with no activation API;
public status stays unknown/unconnected. Continuous monitoring, signed events,
notification delivery and push remain inactive.

Local validation passed: `npm run check` with 37 unit tests and 26 runtime/D1
tests, browser smoke with system Chromium, local migration application and
Wrangler deployment dry run. New cases cover concurrent idle commits, quiet
interval timing and expiry, outage recovery without losing an epoch, atomic
rollback, scope cleanup, field sanitization, disabled production notices and
scope changes made by the previous Worker during migration/upload. Hosted
migration/deployment subsequently passed as recorded above.

## Manual Actions check deployment

After main CI passed, commit `5b47a32111e43125e0253ae3fa4ec452aa667fa2`
was deployed manually as Cloudflare version
`6c73db6b-d1ad-443f-9c4c-bdac91bf496f`. Wrangler confirmed no pending
migrations. Existing scope/session data, Worker secrets and configuration were
preserved. Automatic GitHub deployment remains disabled; its workflow was skipped.

HTTPS checks confirmed the manual Actions button and empty-check wording are
deployed, POST requires owner sign-in (401), GET is rejected (405), auth/status
responses are uncached, health is OK and sign-in remains configured. Public
status is still unknown/unconnected. No Actions request was made by these
unauthenticated probes. The owner subsequently verified an empty check covering
all four public repositories with real GitHub data.
Continuous monitoring, webhook ingestion and push remain inactive.

## Manual Actions check preparation

The owner confirmed saved-scope setup, persistence across refresh, disconnect
and saving again work in the live browser. Public scope setup is now verified.

The next change adds an owner-triggered Actions observation with complete
unfinished-status pagination, visibility/access revalidation, request limits,
attempt-aware run links and scope revision fencing. It does not persist run
state or assert global idle. No new database migration, permission or secret
is required. The code is deployed as recorded above; public status remains unknown and
webhooks, scheduled checks and push remain inactive.

Local validation passed: `npm run check` (35 unit tests and 19 workerd/D1
integration tests), browser smoke with system Chromium, and Wrangler deployment
dry run. Coverage includes 101 active runs across pages, all five statuses,
simultaneous workflows and attempts, private visibility changes, provider limits,
malformed/truncated data, and disconnect during a scan. No real Actions request
has been made by the engineer through the new handler; real installation
validation remains an owner browser check after deployment.

## Saved public scope deployment

After main CI passed, commit `564ec9b02a094ca7375868007f53c11bb97d8e02`
was deployed manually as Cloudflare version
`4d0c00c8-49c5-4f17-9479-84ca06419aa1`. Migration
`0002_monitoring_scope.sql` applied successfully to the existing hosted D1
database before Worker upload. Existing owner session records and Worker secrets
were preserved. Automatic deployment remains disabled; its workflow was skipped.

HTTPS checks confirmed the save/reload/disconnect controls are deployed,
monitoring-scope GET/POST/DELETE require sign-in (401), unsupported methods return
405, API responses are uncached, and health/sign-in configuration remain ready.
A read-only D1 query confirmed the new scope starts empty at revision zero.
Public status is still unknown/unconnected; no Actions monitoring has started.
The owner verified saving all four public repositories, persistence across
refresh, and disconnect followed by saving again in the real browser.

## Saved public scope preparation

The owner confirmed persistent sign-in and all-device sign-out work in normal
and private browser windows. That live verification is complete.

The next change adds migration `0002_monitoring_scope.sql` and owner-only
save/reload/disconnect controls. Saves require fresh complete verification and
persist only public records. Revision checks prevent a slow save from restoring
a disconnected scope. The code and migration are now deployed as recorded
above. Actions monitoring,
scheduled checks, webhook ingestion and push remain inactive.

Local validation passed: generated types, TypeScript, 35 unit tests, the existing
seven workerd/D1 tests and five new scope integration tests, including real SQL
revision races, private-repository exclusion, partial verification and malformed
stored data. Browser smoke passed with system Chromium, including save conflict,
reload, disconnect, mobile layout and sign-out. The new migration applied locally;
its remote application subsequently passed during deployment as recorded above.

## Persistent session deployment

PR #8 and main CI passed. Main commit
`10a12d0ab89a2cf2d2dc8fecb1e16dc35a42d4b5` was deployed manually as
Cloudflare version `361247df-ce03-4097-8226-ccd0c98f1ced`. The deployment
confirmed the hosted database has no pending migrations and bound `DB` to the
existing `github-nanny` database. Existing Worker secrets were preserved.
Automatic GitHub deployment remains disabled; its workflow was skipped.

HTTPS checks confirmed health, configured sign-in, the all-device sign-out UI,
401 protection on repository access and unauthenticated sign-out, and 405 for
GET on all-device sign-out. API responses remain uncached. Public monitoring
status is still unknown and unconnected; no Actions monitoring has started.

Existing stateless sessions require a fresh browser sign-in. The owner verified
reauthentication and all-device revocation across normal and private browser
sessions. Local workerd/D1 tests also cover both revocation paths.

## Persistent session preparation

The owner confirmed complete access: 20 personal repositories (three public,
17 private) and the required public `stormbots` repository. The owner chose to
monitor only the four public repositories; private activity is excluded.

Created D1 database `github-nanny` in WNAM, ID
`c34f0c4b-a637-4ad9-94be-c60f1b0ef9a1`, and configured binding `DB`.
Migration `0001_owner_sessions.sql` passed both local and remote application.
No paid plan was enabled. The database was prepared before the live Worker was
updated; the persistent-session deployment is recorded above.

The persistent-session code and all-device logout passed local unit, workerd/D1,
browser and packaging checks, followed by CI and deployment as recorded above.
Existing stateless sessions need one fresh sign-in after that deployment. Monitoring
state persistence, webhook ingestion and actual Actions monitoring are not active.

## Organization access deployment

After main CI passed, commit `8645302e4603497454ffbe915d74bef7fb32c539`
was deployed as Cloudflare version `86447782-4223-4213-bf99-aed77c8ca70d`.
The `stormbots` immutable ID and required repository are included in the Worker
configuration. Existing secrets and owner-only authorization were preserved.

HTTPS checks confirmed the organization/required-repository UI is deployed,
unauthenticated inventory access returns 401 with no-store caching, sign-in
remains configured, and health is OK. Public monitor status remains unknown.
An unauthenticated GitHub App metadata lookup returned 404, consistent with the
existing private registration. The owner must enable other-account installation
and install/approve the App in `stormbots`, then repeat the authenticated access
check. The owner subsequently confirmed both accounts and the required
organization repository are verified.

## Organization access preparation

The owner confirmed real personal repository access for `github-nanny`,
`locus-tether`, and `verify`. The required public repository
`stormbots/Tactics-Strategy-Dev-Environments` is absent because the deployed
inventory only checks the personal installation.

The organization extension passed CI and is deployed as recorded above. It adds
the explicit `stormbots` scope and required-repository check. The GitHub App must
allow other-account installation and have a separate organization installation
including the required repository. That organization installation is now
verified. Personal success alone is insufficient for the declared requirement.

## Repository access check deployment

After main CI passed, commit `9df27529dcf48899f39dc59313fc47f7af09288f`
was deployed as Cloudflare version `1fc2874e-9877-4994-91ec-fb2a6b34ae2c`.
The existing Worker secrets and public configuration were preserved.

HTTPS checks confirmed the deployed settings bundle contains **Check repository
access**, `/api/admin/repositories` rejects an unauthenticated request with 401
and no-store caching, sign-in remains configured, and health is OK. Public
monitor status remains unknown/unconnected. The owner's authenticated check
verified the App key, personal installation permissions and the three personal
repositories. Organization access needs the next extension and separate setup.

## Repository discovery preparation

The owner reports saving the App's read permissions, All repositories selection,
and private key directly in Cloudflare. Wrangler's secret-name listing confirms
`GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_SECRET` and `SESSION_SECRET` are present.
Their values were not read. The owner-only access check passed local and GitHub
CI checks and is deployed as recorded above. The owner verified its personal
inventory. Organization verification is still pending.

## Owner sign-in fix deployment

After main CI passed, commit `310c7a0d57a0ddc33dafbb57cd0ef24f367d1be0`
was deployed as Cloudflare version `1164b1b7-2802-406b-a2d7-7283bf2f456d`.
The existing secrets and public configuration were preserved.

The live callback now returns `verification` for an intentionally invalid code
with fresh, valid browser state. Before the fix it returned `provider` without
sending an outbound request. This verifies the exchange reaches GitHub; it does
not replace a real owner authorization test. The session endpoint reports
configured and unauthenticated, health is OK, and monitor status remains unknown
and unconnected. The owner then completed real browser authorization and
confirmed `/settings` shows **Signed in as rdpollard** with the identity
connected notice. The owner installed the App and reports saving repository read
permissions and All repositories. Server-side installation verification and
live repository discovery are still pending. Denial of another real GitHub
account has not been exercised.

## Sign-in diagnostics deployment

After CI passed, main commit `58c7190e220e35b352d92e654546f4104a72f4cd`
was deployed as Cloudflare version `a1f869ff-af08-4173-9324-7e398c5e867a`.
Existing secrets were preserved. HTTPS checks confirmed configuration is ready,
missing browser state returns the `state` outcome, and an intentionally invalid
code with valid browser state returns `provider` without creating a session.

The failure was reproduced in local workerd before any outbound request:
Workers rejects `fetch` with `redirect: 'error'` during request construction.
Node's mocked provider tests accepted that option, and the original workerd
test did not exercise the code-exchange request.

The correction uses `redirect: 'manual'` and explicitly rejects all 3xx
responses. A full workerd callback test now covers token exchange, identity
lookup, owner session creation and redirects from both provider endpoints.
This correction passed CI and was deployed as recorded above. Real owner
sign-in remains to be verified.

## Owner connection deployment

The tested `main` commit `fc1b6624a98af06ca843c330e470c4edc7308a89` was
deployed manually with the pinned Wrangler CLI after main CI passed. GitHub
Actions deployment remains disabled until its separate credentials and gate are
configured.

- URL: https://github-nanny.github-nanny.workers.dev/settings
- Cloudflare version: `b931d6d3-8134-4498-b1ec-de67fa1e995a`.
- Public Client ID and app slug are configured for GitHub App `gh-nanny`.
- `SESSION_SECRET` was generated with 32 random bytes and uploaded as a Worker
  secret alongside the code. Its temporary private upload file was removed.
- The owner entered `GITHUB_CLIENT_SECRET` directly in Cloudflare. No client
  secret has been sent through chat or committed.

HTTPS checks confirmed `/settings`, `/api/health`, `/api/status` and
`/api/auth/session` return 200. After secret installation the uncached session
response reports `configured: true`. The login endpoint redirects to GitHub with
the expected Client ID, redirect URI, S256 PKCE and secure state cookie. This
checks configuration format, not whether GitHub accepts the secret.

The first real attempt exposed a missing registered redirect URI. After the
owner added it, the app returned a generic sign-in failure. The cause
was subsequently traced to an unsupported Worker fetch option, as described
above. The deployed diagnostics distinguish state, credential, code, redirect,
exchange and identity failures using fixed outcomes, without exposing provider
payloads. Public status remains unknown and unconnected; live monitoring and
push are not implemented.

## Initial deployment

Cloudflare accepted the first `github-nanny` deployment on 2026-11-19 using the
project's pinned Wrangler CLI and the owner's authenticated personal account.

- URL: https://github-nanny.github-nanny.workers.dev/
- Sample-data preview: https://github-nanny.github-nanny.workers.dev/?demo=1
- Source: `e7b7e76708c562ab9de23d6cedbab863af1fdf72` on
  `codex/project-foundation` (PR #1).
- Cloudflare version: `f25a7095-20cd-490a-9223-3f94e23ce154`.
- Resources: one Worker and static assets; no D1 database or paid plan was
  provisioned by the deployment command.

This is a UI scaffold. Live GitHub ingestion, global reconciliation and push
delivery are not connected. The default status remains unknown; sample data is
available only through the explicit demo query parameter.

The new workers.dev subdomain was registered during the first upload. Initial
TLS/connection failures cleared after provisioning. Verified HTTPS 200 responses
for the homepage, `/api/health`, `/api/status`, the manifest and offline page.
The health endpoint returns `{"ok":true,"service":"github-nanny"}` and status
correctly reports an unconnected, unknown monitor. Public rendered-page retrieval
also confirmed the demo displays three active sample runs across two repositories.

The interactive desktop/mobile, filtering, theme, service worker and offline
regression checks passed locally against a production build. Those interactive
checks were not repeated against the public host: the workspace browser could
not trust the workspace proxy's certificate. Deployment availability was verified
with HTTPS requests and independent rendered-page retrieval instead. Real-device
push remains future work.

## GitHub Actions connection

The current GitHub integration returned HTTP 403 when attempting to access the
repository's Actions secrets public key. Neither Cloudflare secret was written,
and automated deployment remains disabled.

The repository owner must add the following at:
https://github.com/rdpollard/github-nanny/settings/secrets/actions

- `CLOUDFLARE_ACCOUNT_ID`: account ID shown by `wrangler whoami`.
- `CLOUDFLARE_API_TOKEN`: a scoped, durable Cloudflare API token authorized to
  deploy the existing `github-nanny` Worker. See setup.md for permissions.

PR #1 is merged and main CI passed at `586b2d0172da04dc6228472ed62518861a7f82c4`.
Once the secrets are set, enable the repository Actions variable
`CLOUDFLARE_DEPLOY_ENABLED=true` when automatic public releases are desired.
Local OAuth tokens and MCP credentials must not be copied into CI.

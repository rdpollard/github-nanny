# Deployment status

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

Existing stateless sessions require a fresh browser sign-in. Real owner
reauthentication and revocation across two browser sessions remain to be verified
by the owner; local workerd/D1 tests already cover both revocation paths.

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

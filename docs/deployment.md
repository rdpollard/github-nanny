# Deployment status

## Owner sign-in fix deployment

After main CI passed, commit `310c7a0d57a0ddc33dafbb57cd0ef24f367d1be0`
was deployed as Cloudflare version `1164b1b7-2802-406b-a2d7-7283bf2f456d`.
The existing secrets and public configuration were preserved.

The live callback now returns `verification` for an intentionally invalid code
with fresh, valid browser state. Before the fix it returned `provider` without
sending an outbound request. This verifies the exchange reaches GitHub; it does
not replace a real owner authorization test. The session endpoint reports
configured and unauthenticated, health is OK, and monitor status remains unknown
and unconnected. The owner must now retry sign-in in their browser.

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

# Initial deployment

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

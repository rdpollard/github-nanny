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

The new workers.dev subdomain was registered during the first upload. Cloudflare
confirmed the deployment is active. Initial endpoint checks encountered a TLS
provisioning/connection failure, so the public hostname still needs a successful
health check before availability is established. Do not work around provisioning
by disabling TLS verification.

## GitHub Actions connection

The current GitHub integration returned HTTP 403 when attempting to access the
repository's Actions secrets public key. Neither Cloudflare secret was written,
and automated deployment remains disabled.

The repository owner must add the following at:
https://github.com/rdpollard/github-nanny/settings/secrets/actions

- `CLOUDFLARE_ACCOUNT_ID`: account ID shown by `wrangler whoami`.
- `CLOUDFLARE_API_TOKEN`: a scoped, durable Cloudflare API token authorized to
  deploy the existing `github-nanny` Worker. See setup.md for permissions.

Once these are set, merge PR #1 and enable the repository Actions variable
`CLOUDFLARE_DEPLOY_ENABLED=true` when automatic public releases are desired.
Local OAuth tokens and MCP credentials must not be copied into CI.

# Setup and deployment

## Local development

Use Node 24+, run `npm ci`, then `npm run dev`. The Cloudflare Vite plugin
provides the API and frontend together. `npm run check` validates generated
types, type-checks, runs unit tests, builds and exercises real workerd/D1 tests.
CI also runs browser smoke and a deployment dry run. No credentials are needed
for the explicit sample preview at `/?demo=1`.

For local owner integration, copy `.dev.vars.example` to an untracked `.dev.vars`
and configure separate development credentials/state. Never use VITE_* or
localStorage for server credentials. Apply the local schema before signing in:

```sh
npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
```

## Production resources and configuration

The production Worker `github-nanny`, workers.dev address and WNAM D1 database
are already created. Migrations 0001–0007 are deployed. Real GitHub owner sign-in,
saved public scope, signed webhooks and scheduled Actions checks are verified.
The owner enabled idle alerts and verified automatic receipt on both devices.
Notification click-through is being corrected and still needs device retesting. No paid plan has been enabled.

Non-secret identifiers, canonical APP_ORIGIN, owner ID, App slug/client ID and
configured organization requirements are in `wrangler.jsonc`. The verified scope
contains only the four public repositories listed in requirements.md. The 17
accessible private repositories do not receive Actions queries or affect idle.

Installed Worker secrets are:

- `GITHUB_CLIENT_SECRET`
- `GITHUB_APP_PRIVATE_KEY`
- `SESSION_SECRET`
- `GITHUB_WEBHOOK_SECRET`
- `WEB_PUSH_PRIVATE_KEY`
- `PUSH_STORAGE_SECRET`

Keep their values out of chat, source, fixtures and logs. The App identity token
is used once and discarded; request-local installation tokens are not persisted.
Push subscription credentials are encrypted in D1. No additional generic token
storage secret or legacy VAPID_PRIVATE_KEY variable is used.

See [github-connection.md](github-connection.md), [webhooks.md](webhooks.md),
[push-devices.md](push-devices.md) and [idle-alerts.md](idle-alerts.md) for setup,
key formats and owner controls. Preserve existing secrets during ordinary
releases. Do not rotate push keys when rotating the webhook secret.

## Wrangler sign-in from a remote workspace

Cloudflare MCP and Wrangler authentication are separate. The pinned Wrangler
supports device authorization without forwarding a localhost callback:

```sh
npx wrangler login --device --browser=false --scopes account:read user:read workers:write workers_scripts:write d1:write
npx wrangler whoami
```

Open the displayed verification URL and enter its short-lived device code.
Wrangler stores credentials outside the repository. This task uses a private
temporary XDG_CONFIG_HOME directory; use the same value on later Wrangler
commands. It is not a durable CI credential store. Select the existing account
explicitly if multiple accounts are available.

## Manual release after checks

Apply hosted migrations before uploading the built Worker:

```sh
npm run build
npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
npx wrangler deploy
```

The final command uses the Vite build's redirected Wrangler configuration,
which supplies the generated asset directory. Selecting the source config for
the upload bypasses that generated directory. `npm run deploy` performs the
build/migration/upload sequence as well.

Verify health, current assets, uncached status, owner-route protection, preserved
scope/devices/secrets and alert readiness after a release. Record source SHA and
Cloudflare version in deployment.md. Do not fabricate an owner session to bypass
browser verification. Use the real signed-in owner settings for activation.

Scope saves/disconnects pause monitoring and alerts. Start checks, then enable
idle alerts deliberately after fresh verification. Sign-out revokes a stored
owner session; it does not remove device registrations or stop monitoring.

## GitHub CI/CD and engineering handoff

`ci.yml` runs on PRs and main pushes with read-only repository permissions. It
uses the lockfile and runs all checks, browser smoke and a deployment dry run.
The engineer shares one CI link after starting a run, then waits for the user's
completion message. Do not install status watchers or poll engineering CI.

`deploy.yml` runs on main pushes or manual dispatch. Its serialized deploy job
is gated on repository variable `CLOUDFLARE_DEPLOY_ENABLED` being exactly `true`.
It independently runs checks before migrations/upload and does not cancel a
production deployment already in progress. The gate is currently disabled.

Automatic deployment needs separate Actions secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. The token must authorize deployment of the existing
Worker and D1 migration queries, with resources scoped as narrowly as possible.
An interactive local OAuth login does not authenticate GitHub Actions, and its
short-lived credentials must not be copied into CI. The owner must install the
CI credentials directly in GitHub because the current connector returned 403
for Actions-secret administration. Enable the repository gate only when those
credentials are installed and automatic public releases are intended.

See [release-checklist.md](release-checklist.md) for activation, acceptance,
recovery and the remaining owner steps. No gate or paid resource is enabled by
editing these documents.

## Usage and cost

The current four-repository complete check normally uses 34 GitHub requests per
minute, split across two installation limits. At most four outbound pushes can
follow a scheduled check. Public dashboard refreshes read D1 and spend no GitHub
requests. Larger scopes, pagination and actual run volume can change usage.

Measure Worker CPU, D1 operations/storage and installation rate limits in the
existing accounts before selecting upgrades. Current pricing and limits:

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/workers/authorization/workers/

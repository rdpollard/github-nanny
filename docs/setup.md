# Setup and deployment

## Local scaffold

Install Node 24+, run `npm ci`, then `npm run dev`. The Cloudflare Vite plugin
provides the API and frontend together. `npm run check` checks types, executes
tests, and builds frontend/Worker outputs. No secrets are needed for local demo.

## CI/CD

`ci.yml` runs on PRs and pushes to main with read-only repository permission.
It uses the lockfile, executes unit/type/build and browser smoke checks, and
performs a deployment dry run.
`deploy.yml` runs on main pushes or manual dispatch, but only when the repository
variable `CLOUDFLARE_DEPLOY_ENABLED` is exactly `true`. The deploy job independently
runs checks before deploying. Until enabled, CI requires no host credentials.

Use one production deploy at a time. The workflow does not cancel a deployment
already in progress. No privileged workflow runs on untrusted PR code.

## First Cloudflare setup (when ready)

### Wrangler sign-in from a remote workspace

Cloudflare MCP authentication and Wrangler authentication are separate. A
desktop MCP connection is not required to build or deploy this project.

The pinned Wrangler version supports device authorization, which works without
forwarding a localhost callback port:

```sh
npx wrangler login --device --browser=false --scopes account:read user:read workers:write workers_scripts:write d1:write
npx wrangler whoami
```

Open the printed Cloudflare verification URL and enter the short-lived device
code. Do not paste API tokens into chat or source files. Wrangler stores the
resulting credentials outside the repository. When using a custom
`XDG_CONFIG_HOME`, use the same value on subsequent Wrangler commands; it changes
where credentials are stored. This development workspace uses a private
temporary config directory, which is not a durable CI credential store.

The selected scopes cover account discovery, Workers deployment and the planned
D1 integration. Wrangler may warn about other omitted product scopes; only add
them when the project needs those products. Device login adds refresh access
automatically. Verify the account before deployment, and set
`CLOUDFLARE_ACCOUNT_ID` explicitly when there is more than one account.

### Automated GitHub deployments

1. Create a Cloudflare account and use Workers Free initially. No domain purchase
   is required; a workers.dev address is sufficient. Check current free limits.
2. Find the account ID. Create a scoped API token permitting Worker deployment
   for this account; add D1 permissions when migrations are introduced.
3. In github-nanny repository settings, add Actions secret
   `CLOUDFLARE_API_TOKEN` and secret `CLOUDFLARE_ACCOUNT_ID`.
4. Set repository variable `CLOUDFLARE_DEPLOY_ENABLED=true` only when a public
   deployment is intended. Run the deploy workflow or merge to main.
5. Record the workers.dev URL. Monitor usage in Cloudflare before considering
   a paid plan. Building this code does not itself create billable resources.

The initial scaffold can be deployed for UI review, but will still report
unknown and cannot send notifications. Owner sign-in code is implemented in
`main` and deployed with its secrets, and real owner sign-in is verified. App
installation and live repository monitoring are still pending.

An interactive Wrangler login does not authenticate GitHub Actions. CI requires
its own account-scoped Cloudflare API token. Prefer an account-owned token with
Editor access limited to the existing `github-nanny` Worker; creating a new
Worker requires product-level Admin. Use a separate provisioning token if
resource creation is needed later. Bound D1 resources do not require additional
permissions merely to deploy Worker code, but creating/querying databases does.
Store the token directly in GitHub Actions secret `CLOUDFLARE_API_TOKEN`, never in
chat or a commit. Do not copy the short-lived local OAuth access token into CI.

Keep `CLOUDFLARE_DEPLOY_ENABLED` disabled until the token is installed and automatic
public releases from main are intended. The foundation and owner sign-in code
are merged into `main` and deployed manually. See deployment.md for the version
and remaining owner activation step.

## GitHub App setup (milestone 2)

App `gh-nanny` is registered and its public identifiers are configured. Follow
[the connection guide](github-connection.md) for callback settings and secret
installation. Keep webhooks inactive until ingestion is implemented. When that
handler exists, subscribe to relevant Actions, installation, and repository
events and install on all personal-account repositories. Repositories owned by
other accounts/organizations require their own access and installation decision.

The implementation provides an owner GitHub ID allowlist and owner-only
session. GitHub sign-in does not require a custom password database. Its client
secret and app private key must remain on the server. Generate a strong webhook
secret, validate SHA-256 signatures, and store delivery IDs for idempotency.

When implemented, add these using `wrangler secret put NAME` from a secure local
terminal or Cloudflare's secrets interface, never into source files or chat:

- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_WEBHOOK_SECRET`
- `SESSION_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `VAPID_PRIVATE_KEY`

Public identifiers such as App ID, client ID, owner user ID, public VAPID key,
and app origin will be documented alongside the integration that uses them.
Do not add unused secrets to this scaffold.

D1 database creation, bindings, migrations, callback routes, Web Push key
generation, and subscription setup will be documented with their implementation.
Separate development and production state/credentials so demo runs cannot notify
production devices.

## Cost assumptions and references

Personal use, one account and a handful of devices. Repository count/run volume
are still unknown. Free limits and GitHub API budgets must be measured; an
estimated $0 host bill is not guaranteed. Workers paid starts at $5/month under
the current published plan, plus usage beyond included allowances. No paid
notification provider is required by standards-based Web Push.

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/workers/wrangler/commands/general/#use-wrangler-login-without-a-local-callback-server
- https://developers.cloudflare.com/workers/authorization/workers/
- https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers

# github-nanny
A PWA that tattles on GitHub when it finishes Actions

GitHub Nanny will watch every run in the connected GitHub repositories and send
one push notification when the account returns to idle. Success, failure,
cancellation, and other terminal conclusions all count as finished.

## Current status

This is the foundation and owner connection code, not a live monitor yet. It includes:

- A responsive React dashboard adapted from GitHub Workflow Dashboard, including
  repository cards, status badges, filters, compact mode, and light/dark themes.
- An explicit sample-data preview at `/?demo=1`.
- A Cloudflare Worker with `/api/health` and `/api/status` endpoints. Until
  account integration is implemented, status is always **unknown**, never idle.
- A web manifest, service worker, and offline fallback. No cached status is
  presented as live. Final device installation checks remain on the roadmap.
- A tested idle-decision function, GitHub Actions CI, and deployment workflow.
- GitHub App owner sign-in with PKCE and secure, signed session cookies. Sign-in
  remains disabled until the GitHub App settings and secrets are configured.
- Persistent D1 owner sessions and all-device sign-out are deployed and verified
  in the owner's normal and private browser sessions.
- Owner connection settings at `/settings`; this does not yet authorize live
  repository monitoring or change the public unknown-status response.
- An owner-only repository access check with GitHub App authentication,
  pagination, explicit organization scopes and required-repository gaps.
  It runs only when the owner clicks the check button.
- An owner-only saved public scope, fresh verification before saving, and a
  disconnect action. This is deployed, awaiting owner verification, and does not start Actions
  monitoring. A saved inventory is not proof of current access or idle.

Webhook ingestion, run-state persistence, live reconciliation, and actual push delivery
are the next milestones. The decision function is not
wired to a live ingestion pipeline yet. The owner connection code is deployed;
its secrets are installed, and real owner sign-in is verified. Repository access
checking is deployed and the personal inventory is verified. The organization
extension is deployed and verified for the required `stormbots` repository.
The owner selected only the four public repositories for monitoring; the 17
accessible private repositories are excluded. Live monitoring is not started.

## Local development

Use Node.js 24 or newer and npm. No GitHub or Cloudflare credentials are needed
to run the scaffold locally.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. The Cloudflare Vite plugin runs the Worker
API alongside the frontend. Add `/?demo=1` for sample activity; those names and
counts are not your GitHub data. Local preferences stay on each device.

```sh
npm run check    # Generated types, unit tests, production build and workerd tests
npm run preview  # Build and serve using the Worker runtime
```

The browser regression check runs against a production preview it starts itself:

```sh
npx playwright-core install chromium
npm run build
npm run test:browser
```

Alternatively, set `CHROMIUM_PATH` to an existing Chromium executable. CI installs
its browser and runs this check automatically. It covers demo filters, mobile
layout, unknown live status, service worker registration, and offline navigation.

## Project guide

- [Requirements](docs/requirements.md)
- [Architecture and idle detection](docs/architecture.md)
- [Milestones](docs/roadmap.md)
- [Cloudflare and GitHub setup](docs/setup.md)
- [GitHub owner connection setup](docs/github-connection.md)
- [Initial deployment and CI connection status](docs/deployment.md)
- [Upstream evaluation and attribution](docs/upstream.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Deployment

Cloudflare Workers hosts the app at
https://github-nanny.github-nanny.workers.dev/. See [deployment status](docs/deployment.md)
for availability checks and remaining integration work. Deployment is disabled
in GitHub Actions until you configure the credentials and enable it; see
[setup](docs/setup.md). Normal releases then deploy from `main` after checks pass.

## License

The project retains its GPL v3 license in [LICENSE](LICENSE). Selected upstream
dashboard components retain their MIT notices in
[licenses/github-workflow-dashboard.txt](licenses/github-workflow-dashboard.txt).

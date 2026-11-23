# github-nanny
A PWA that tattles on GitHub when it finishes Actions

GitHub Nanny will watch every run in the connected GitHub repositories and send
one push notification when the account returns to idle. Success, failure,
cancellation, and other terminal conclusions all count as finished.

## Current status

Automatic checks are deployed and enabled. The owner verified the public
dashboard showing confirmed idle across four repositories, and hosted checks
cover all four without errors. Real signed workflow delivery is also verified.
Encrypted owner-only device registration and a test-notification button are
deployed with server keys configured; actual device receipt remains to be verified. Automatic idle
notifications remain disabled.

- Responsive React dashboard, filters, compact mode and light/dark themes,
  adapted from GitHub Workflow Dashboard; explicit sample preview at `/?demo=1`.
- GitHub App owner sign-in, revocable D1 sessions, installation verification and
  a saved public-only scope: three personal repositories plus the required
  `stormbots/Tactics-Strategy-Dev-Environments` repository. The 17 private
  repositories are excluded from Actions queries and activity decisions.
- Signature-verified events with deduplication and per-attempt ordering.
- Owner Start/Pause controls for checks about once a minute. Start revalidates
  access; installation/scope changes require fresh verification.
- A bounded complete Actions scan, durable activity state, two-scan idle
  confirmation, fenced worker leases and rate-limit backoff. Initial quiet
  does not create a notification epoch.
- A read-only public status feed from D1. Public refreshes never query GitHub.
  Unknown/stale/failed checks hide run details and cannot claim idle.
- Web manifest, service worker and offline fallback; actual device installation
  and background push verification remain on the roadmap.
- GitHub Actions CI with user-coordinated engineering handoffs. Automatic
  deployment remains disabled until separately configured.

See [automatic checks](docs/reconciliation.md) for activation and limits.
Notification creation and delivery remain disabled in production. Deployment
alone does not start GitHub API scans; the owner must activate them in settings.

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
- [GitHub webhook receiver and setup](docs/webhooks.md)
- [Push devices and test notifications](docs/push-devices.md)
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

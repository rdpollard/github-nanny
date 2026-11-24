# Release verification and operations

## Current production state

The public PWA is deployed at https://github-nanny.github-nanny.workers.dev/.
Monitoring and idle alerts are owner-enabled for the four saved public
repositories. Two registered Vivaldi devices are preserved. Test receipt is
verified on Windows 11 and Android; Android foreground banner behavior differs
from its notification-shade receipt. The owner verified automatic idle receipt
on both devices after PR #17 CI. The deployed tap-v2 handler is verified to open
Nanny from test notifications in Edge/Windows and Chrome/Android. The owner
accepted these platforms and closed further Vivaldi-specific work. Automatic
idle run-link navigation on the new Edge/Chrome registrations remains separate
from verified test tap-to-open; see [notification-taps.md](notification-taps.md).

The saved scope is:

- rdpollard/github-nanny
- rdpollard/locus-tether
- rdpollard/verify
- stormbots/Tactics-Strategy-Dev-Environments

Private repositories are excluded. Queued, running, requested, waiting and
pending runs block idle. A first quiet period is silent. After observed public
activity, two complete empty checks confirm idle, normally within roughly one
to two minutes plus scheduling/network delay.

## Automatic-alert acceptance

Use an ordinary engineering CI run, including this documentation PR's checks.
There is no polling workflow or separate engineering status watcher.

1. Confirm Nanny observes activity while CI runs. If another monitored repository
   is busy, it also must finish before the global idle notification is eligible.
2. Leave the phone app in the background or lock the phone. Keep notifications
   allowed on Windows. After all four repositories become idle, confirm one
   **GitHub is idle** notification on each enrolled device. Test notifications
   have a different title and do not satisfy this check.
3. Open the notification, confirm Nanny opens, and use **View run on GitHub**
   to confirm the run-attempt link is relevant.
   The body describes the time of the complete check, not a promise that no new
   work can begin afterward.
4. Confirm continued quiet produces no additional idle reminder. A subsequent
   real activity period should produce one new epoch/notification per device.
5. Report CI completion to Codex manually as agreed. A push notification does
   not itself resume this Codex chat. Report receipt/link results separately
   if other GitHub activity delays global idle beyond the CI run.

Provider acceptance is not proof of visible device receipt. Owner settings show
ready-device/pending/issue counts, and hosted D1 stores fixed delivery outcomes
for the short-lived current epoch. Do not share endpoint URLs, subscription keys,
Worker secrets or raw provider payloads when troubleshooting.

## Stop, recovery and scope changes

- **Disable idle alerts** cancels pending alert work and keeps Actions checks on.
- **Pause automatic checks** also disables alerts and clears current confidence.
- Saving or disconnecting scope disables checks/alerts; verify access, restart
  checks and deliberately re-enable alerts after a scope change.
- Removing a device cancels its queued deliveries. Register again from that
  browser when needed. Browser permission is managed separately.
- Keep push secrets stable across deployments. Rotations require device
  re-registration; a webhook-secret rotation does not require rotating push keys.
- Failed scans produce unknown status and defer delivery. Do not force idle by
  editing D1 state or taking a partial result. Check the configured scope and
  owner error message before retrying.
- For a rollback, disable alerts first, then deploy a known compatible prior
  version. Additive migrations remain present; a prior version may not understand
  enabled alert state. Preserve registrations and secrets, and verify controls
  after rollback. Do not set notice_enabled directly as an activation shortcut.

## Deploying from GitHub Actions

The checked-in Deploy workflow runs on main pushes or manual dispatch, with
read-only repository permissions and serialized production deployment. Its job
checks credentials, runs `npm ci`, `npm run check`, browser smoke and a dry run,
applies hosted D1 migrations, uploads Worker/assets and checks public health.
Manual dispatch is restricted to main. It does not deploy PR code. The repository variable
`CLOUDFLARE_DEPLOY_ENABLED` is owner-enabled; the first manual main deployment
passed in run `45475925420`.

For a new installation or credential replacement, install a separate durable
Cloudflare CI token and account ID in the repository's Actions secrets:

- `CLOUDFLARE_API_TOKEN`: permission to deploy the existing Worker and execute
  migrations against the existing D1 database; scope resources as narrowly as
  Cloudflare supports.
- `CLOUDFLARE_ACCOUNT_ID`: the existing production account ID.

Enter values directly in GitHub settings, not chat/source. The current connector
could not administer Actions secrets, so these owner steps cannot be completed
through that integration. Local Wrangler OAuth credentials are not CI tokens.
Enable `CLOUDFLARE_DEPLOY_ENABLED=true` only when automatic releases are intended;
then use a normal main release or the Deploy workflow's manual dispatch. This
checklist does not enable the gate or create/rotate any credential.

See [production-cicd.md](production-cicd.md) for exact credential/activation steps,
[setup.md](setup.md) for commands and
[deployment.md](deployment.md) for exact deployed source/version records.

## Remaining launch checks

- Verify automatic idle run-link navigation on the newly enrolled Edge/Chrome
  devices. Test taps open Nanny; automatic receipt is already verified on Vivaldi.
- Background/lock-screen behavior and a Linux browser's real push receipt.
- Verify deployed launcher icons and actual installation after the PNG/maskable/Apple
  icon update; see [pwa-installation.md](pwa-installation.md) for Linux/device steps.
- Worker CPU/account usage and GitHub installation-rate headroom.
  D1 usage is measured in [usage-review.md](usage-review.md); no paid plan is enabled.
- Optional iOS Home Screen testing and optional Codex chat links, when relevant.

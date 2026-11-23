# Automatic idle alerts

This milestone connects confirmed global idle to encrypted per-device delivery.
It is deployed and owner-enabled, pending real end-to-end receipt verification.
Existing registrations and push secrets were preserved;
no device needs to grant permission again.

## Activation and end-to-end verification

1. After main CI, apply migration `0007_idle_delivery.sql`, then deploy the built
   Worker/assets. The migration adds recipient/delivery state and a device
   revision; it preserves existing registrations. Alerts remain off by default.
2. On `/settings`, confirm automatic Actions checks are running and each desired
   browser is registered and has displayed a test. Click **Enable idle alerts**.
   This is an owner-only action. It clears prior notification work and starts a
   fresh observation period; it does not announce an already quiet account.
   Repeated Enable requests for the same active configuration are idempotent.
3. Observe an ordinary workflow run in a monitored repository, including the
   next normal engineering CI. After all four repositories finish every queued,
   running, requested, waiting and pending run, two complete empty observations
   confirm idle. Each enrolled device should receive one alert for that epoch.
4. Check the phone in the background and locked, as well as Windows/Linux.
   Android may retain a notification in its shade without showing a heads-up
   banner while the app is open. A new activity epoch uses a new notification
   tag; retries reuse the same tag to suppress duplicate banners.
5. Clicking the alert opens the relevant GitHub run attempt. The body states the
   time of the complete check; future GitHub activity can begin afterward.
   Browser/OS delivery is best effort, not proof that a device displayed it.

**Disable idle alerts** cancels pending deliveries while Actions checks continue.
Pausing checks, saving/replacing scope or disconnecting also turns alerts off;
re-enable deliberately after verification. Signing out only revokes settings
access. Removing a device cancels its pending deliveries. A later registration
never inherits a previous idle epoch. There is no automatic Codex-chat resume.

## Creation, eligibility and races

Activation requires the revocable owner session, exact canonical Origin, current
prepared scope, enabled monitoring, valid push/webhook configuration and at least
one unexpired device under the current push keys. It invalidates in-flight scan
confidence and clears the activity latch. A new full scan establishes current
activity. First quiet remains silent, and success/failure/cancellation outcomes
all count as completed work.

An idle transition commits the monitor state, unique global-epoch outbox row and
recipient snapshot in one D1 batch. Recipients are the owner's eligible devices
at that instant, bound to their current revision and key generation. Renewing a
subscription increments its revision. Old work cannot send to or remove the
replacement. Scope/device/outbox foreign-key cleanup cancels queued work.

Only the scheduled runner calls the dispatcher, after completing a successful
full scan and releasing its scan lease. Every retry requires another successful
full scan. The scan repeats complete installation discovery and public metadata
checks before/after all unfinished-run queries. A failed, truncated, stale,
conflicting or busy observation cannot dispatch an alert.

The dispatcher checks prepared scope/configuration, current epoch, enabled
monitoring/alerts, fresh complete-check time, no outstanding scan/error, current
recipient revision and expiry, and a canonical saved-public-repository run link.
A separate short delivery lease prevents competing dispatchers from both
claiming a device. Authorization is checked again after encryption, immediately
before the network request. New signed activity, pause, disable, scope loss or
device removal/renewal can invalidate it. A request already accepted by a push
service cannot be recalled; distributed GitHub reads cannot promise no future
activity or visibility changes after verification.

Push configuration is bound to the exact installed secret configuration.
Changing it makes alerts ineffective until an explicit re-enable; old device
keys cannot silently inherit new credentials. Public status exposes only an
alert-enabled boolean, never device IDs, endpoints, encryption keys or delivery
metadata. Owner settings show ready-device/pending/issue counts.

## Budgets, retries and content

At most four push requests follow any one scheduled full scan. The existing
40-request GitHub budget remains unchanged, so the total external request bound
is 44. Remaining recipients wait for a later fresh scan. Each push has a
five-second timeout and a 30-second delivery lease. At most three attempts are
made per device/epoch, with one-minute then two-minute backoff; provider reset or
Retry-After timestamps can extend the wait. Ambiguous failures can duplicate a
transport delivery, so both provider topic and displayed tag are stable per epoch.

Transient network/429/5xx failures retry. Other provider rejections stop retries;
404/410 removes only the still-matching subscription revision. Fixed outcomes
are retained without provider bodies or credential-bearing URLs. Notifications
expire from the outbox after five minutes; each outbound push has a 120-second
TTL. Quiet rechecks do not recreate an expired/accepted epoch or send reminders.
Bounded cleanup removes expired outbox rows and their delivery rows.

Payloads contain only a version/kind, epoch, check timestamp and canonical public
GitHub attempt URL. The service worker constructs fixed notification text and
validates the run URL again before displaying/click navigation. Malformed data
produces a neutral app notification. Explicit tests say they are tests and may
renotify; idle retries do not. No notification or retry creates a GitHub run.

## Validation boundaries

Real workerd/D1 tests cover initial silence, two-device encrypted delivery,
repeat quiet, multiple epochs, owner/origin enforcement, idempotent enable,
retry/backoff and exhaustion, stale/mismatched scope/configuration, recipient
snapshots, expired/replaced devices, late responses, competing dispatchers,
post-encryption activity, pause, disconnect and failed scans. Service-worker
tests cover stable tags and canonical run navigation. Browser smoke covers
explicit enable/disable controls. Real automatic receipt, run-link clicks,
background/lock-screen presentation and Linux receipt remain launch checks.

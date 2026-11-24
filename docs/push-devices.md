# Owner push devices and test notifications

Owner-only device registration, encrypted subscription storage and explicit test
notifications are deployed and verified on Windows/Android Vivaldi. Registration
and tests do not enable idle alerts; the separate owner control does that.
Automatic idle delivery is deployed and owner-enabled. See idle-alerts.md for
end-to-end receipt verification and delivery limits.

## Current device verification

The owner verified actual Vivaldi receipt on Windows 11, both browser-only and
installed PWA, including tests initiated from Android settings. Android 17 with
Vivaldi 8.3.4192.96 also receives the notification in its notification shade.
The owner clarified that the missing behavior was a banner while the app was
open, rather than failed push receipt. Both devices' provider acceptance was
independently verified in hosted D1. Background/locked-phone behavior remains a separate acceptance check.

The owner subsequently verified Linux Mint with Firefox (reported latest releases):
registration, test delivery and clicking the notification to visibly open Nanny
all pass. This closes the Linux test receipt/tap acceptance for that setup.

Repeated test notifications share a tag and can update an existing notification
quietly. Android's foreground banner presentation is controlled by browser/OS
notification categories. Website permission settings are documented at:
https://vivaldi.com/blog/tips/android-tips/tip-548/

Automatic delivery is deployed and the owner has enabled it; see
[idle-alerts.md](idle-alerts.md). A new installation still requires explicit
activation.

## Automatic alert receipt and click follow-up

The owner verified automatic idle notifications on both Windows/Android Vivaldi
devices after PR #17 CI. Tapping opened nothing on either device. The source
click handler now navigates inside Nanny's scope and shows an ordinary **View
run on GitHub** link, rather than directly launching GitHub from the worker.
The tap-v2 follow-up is deployed. Test-notification taps visibly open Nanny in
Edge on Windows 11 and Chrome on Android 17. Chrome's test arrived in the shade
without a banner; that is successful receipt. Vivaldi click-through remains
unresolved. See [notification-taps.md](notification-taps.md) for per-browser
results and diagnostic interpretation. Registrations and push keys stay intact.

## Server setup after main CI

1. Apply migration `0006_push_devices.sql` before uploading the built Worker.
   It adds an independent device table and does not change monitoring or sessions.
2. Generate a stable P-256 VAPID key pair and a separate 32-byte storage secret:
   `node scripts/create-push-secrets.mjs /tmp/nanny-push-secrets-UNIQUE`.
   The directory must be outside the repository and must not already exist.
   The script writes two private files with restrictive permissions, prints no
   values and refuses to overwrite files. Do not paste their contents into chat,
   command arguments, logs or GitHub secrets.
3. Import using the existing authenticated Wrangler CLI, redirecting each file
   into `wrangler secret put WEB_PUSH_PRIVATE_KEY` and
   `wrangler secret put PUSH_STORAGE_SECRET`. Keep the existing Worker secrets.
   Use the established task-specific Wrangler configuration directory in this
   workspace; do not copy local OAuth credentials into CI.
4. Upload using the Vite build's redirected Wrangler configuration, preserving
   the existing deployment gate. No paid resource or automatic deployment is
   required. Verify owner settings expose only the public VAPID key, not the
   private key or device credentials. Missing/invalid keys leave setup disabled.

`WEB_PUSH_PRIVATE_KEY` is a JSON object containing `publicKey` (65-byte
uncompressed P-256 point, canonical base64url) and `privateKey` (32-byte private
scalar, canonical base64url). `PUSH_STORAGE_SECRET` is canonical base64url for 32
random bytes. The generator produces exactly these formats. Keys remain stable
across ordinary deployments and webhook-secret rotations. Rotating either push
secret marks old registrations unready; remove them and register browsers again.
Cloudflare retains Worker secrets across deployments.

## Real-device verification

1. Open `/settings` on each target browser, sign in as owner and locate
   **Push devices**. Permission is never requested merely by visiting the page.
2. Give the device a useful name and click **Register this browser**. Allow
   notifications in the browser prompt. The browser supplies its subscription;
   no endpoint or encryption key is copied manually. Existing matching browser
   subscriptions are reused. A changed VAPID key requires resubscription.
3. Click **Send test to [device]**, then confirm this device displays
   **GitHub Nanny test**. Its body explicitly says automatic idle alerts are not
   enabled yet. Push-service acceptance alone does not prove display. Repeat
   while the app tab is in the background; browser/OS notification settings and
   delivery timing still apply. A click opens Nanny's own dashboard.
4. Verify on the actual phone and Windows/Linux browsers. On iOS/iPadOS 16.4+
   install to the Home Screen, open that installed app and grant permission
   there. Unsupported contexts show installation/support guidance.
5. **Remove [device]** stops future server sends. Browser permission is managed
   separately; re-registering can reuse its existing local subscription. Owner
   sign-out revokes administration, while registrations persist for future
   background delivery. Saving/disconnecting monitoring scope does not delete
   device registrations. Scope changes disable automatic idle alerts until
   deliberate reactivation.

The new service worker activates on upgrade and claims existing app tabs. Reload
settings after deployment if an older tab is still waiting for its worker. Test
messages always produce a visible notification. Unknown/malformed messages show
a neutral prompt to open Nanny, never a claim that GitHub is idle. Notification
clicks ignore payload navigation targets and open only this application's root.

## API and storage contract

All routes use the shared revocable owner session, canonical origin and no-store
headers. Cross-site Fetch Metadata is rejected on every route; mutations require
an exact matching Origin. Subscription bodies are bounded to 4 KiB before JSON
parsing. Caller fields cannot choose notification content or redirect targets.

- `GET /api/admin/push`: setup readiness, public application-server key and
  private owner-only device metadata (ID/name/times/result/readiness). Never
  returns endpoints, subscription encryption keys or encrypted records.
- `POST /api/admin/push`: validate and upsert a named browser subscription.
- `DELETE /api/admin/push`: remove an owner's device by opaque ID.
- `POST /api/admin/push/test`: one explicitly requested test to a stored device.
  No GET, page refresh, webhook or scheduler can trigger a test.

Only HTTPS default-port endpoints belonging to Google's FCM, Mozilla's push
service, Apple's web push service or a named Microsoft notify.windows.com host
are allowed. Credentials, fragments, malformed keys, non-P-256 points and expired
subscriptions are rejected. Unsupported providers require an explicit future
allowlist update. Outbound sends use manual redirect handling, a ten-second
timeout, a fixed test payload and a 60-second TTL. Provider response bodies and
exceptions are never returned or logged.

An atomic D1 registration limit allows ten devices per owner, including under
concurrent requests. Endpoint-derived HMAC IDs are scoped to the immutable owner
ID. Separate HKDF-derived AES-256-GCM and HMAC keys come from the storage secret.
A fresh nonce encrypts each sanitized subscription; authenticated additional data
binds ciphertext to owner, device ID and server-key generation. Swapping records
cannot redirect a send. Old key generations are listed as unready.

Test sends claim a D1 token and reserve at least a minute before another attempt
for that device. Duplicate/concurrent tests cannot both claim. Valid provider
Retry-After/rate-reset headers can extend this wait; tests have no automatic
retries. A 404/410 removes the subscription. Other failures retain a fixed result
and allow a later owner retry. Token fencing prevents a late response from
removing a renewed registration. An already in-flight accepted push cannot be
recalled. Success means the push service accepted a message, not that an OS
actually displayed it.

Worker automatic traces are disabled so outbound push capability URLs are not
retained in trace metadata. Fixed application outcome logs remain available;
HTTP invocation logging remains disabled. Device secrets remain in encrypted D1
records and Worker secrets, never localStorage or public snapshots.

## Validation and remaining work

Runtime tests exercise the built Worker, native Web Crypto and real D1. An
independent Node implementation decrypts an outbound RFC 8291 aes128gcm payload
and verifies the RFC 8292 VAPID signature. Tests also cover auth/CSRF, malformed
requests, tampered records, key changes, concurrent registration/send limits,
provider failures/redirects, expiry and renewed-subscription races. Service-worker
tests cover visible test/fallback notifications and safe click navigation.
Browser smoke mocks provider enrollment only; it verifies permission is requested
from the button gesture and exercises registration, test acceptance and removal.
Actual background receipt on the owner's devices is still required.

Sources:
- https://github.com/block65/webcrypto-web-push/blob/master/packages/web-push/README.md
- https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe
- https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification
- https://www.rfc-editor.org/rfc/rfc8291
- https://www.rfc-editor.org/rfc/rfc8292

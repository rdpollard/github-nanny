# Milestones

## 1. Foundation — implemented

- [x] Versioned requirements and architecture, including scope limitations.
- [x] React/Vite/Worker scaffold with responsive dashboard and explicit demo.
- [x] Preserve GPL license and upstream MIT attribution.
- [x] Unknown-status API until real integration exists.
- [x] Idle-decision function and focused tests for partial scans and races.
- [x] Web manifest/service worker/offline fallback; device checks remain below.
- [x] GitHub Actions checks and a production deployment workflow gated until configured.

## 2. GitHub connection and live dashboard

- [x] Register GitHub App `gh-nanny` and configure its public Client ID and slug.
- [x] Verify registered personal-account permissions/callback and owner installation.
- [x] Owner reports App installed, read permissions saved and All repositories selected.
- [x] Implement owner-only GitHub App authorization, secure signed session
      cookies, browser-bound state and S256 PKCE. Provider identity tokens are
      used once and discarded; configuration/secrets remain required for use.
- [x] Add `/settings` for owner sign-in, installation link and browser sign-out.
- [x] Add fixed sign-in failure outcomes and credential-redaction regression tests.
- [x] Exercise code exchange, identity lookup and redirect rejection in workerd.
- [x] Verify real owner GitHub App authorization after registration and deployment.
- [x] Implement D1-backed owner session revocation, including all-device sign-out.
- [x] Deploy persistent sessions and verify real browser sign-in/sign-out.
- [x] Add saved-scope disconnect and fence concurrent/in-flight scope saves.
- [x] Extend disconnect to invalidate scans, activity and pending notices atomically.
- [x] Create D1 database and add the first session migration.
- [x] Add D1 migrations and persist verified public installation/repository scope.
- [x] Deploy and verify saved-scope setup/disconnect in the owner's browser.
- [x] Implement explicit owner-only installation/repository access check with pagination.
- [x] Deploy the owner-only repository access check after CI.
- [x] Verify the real App key and personal repository inventory in the owner's browser.
- [x] Implement allowlisted organization inventories and required public repository checks.
- [x] Deploy organization support with `stormbots` configured after CI.
- [x] Enable and verify the separate `stormbots` installation and required repository.
- [x] Confirm public-only monitoring: four public repositories; 17 private repos excluded.
- [x] Implement owner-triggered Actions observation across all five unfinished
      statuses, with pagination, scope/visibility checks and per-run attempts.
- [x] Deploy and verify an empty manual Actions check across the four real public repositories.
- [x] Verify a live running organization workflow and persisted busy/activity state.
- [ ] Verify navigation through a real run link on the owner's device.
- [x] Implement signature-verified webhooks, deduplication and per-attempt event ordering.
- [x] Persist scan and event run IDs/attempts; test late completions and reruns.
- [x] Deploy receiver, configure secret/subscriptions and verify a real completed workflow delivery.
- [x] Implement active-run API with scope/freshness and access failure handling.
- [x] Deploy automatic checks, paused controls and the gated public status feed.
- [x] Verify owner activation and the live idle dashboard across four repositories.
- [x] Verify a live automatic busy-to-idle alert on both Windows/Android devices.
- [x] Confirm waiting/requested/pending block idle alongside queued/running.
- [x] Bound MVP coverage to the four confirmed public repositories; outside-account fallback is not in scope.

## 3. Confirmed global idle

- [x] Implement scheduled reconciliation, bounded requests, leased scans and backoff.
- [x] Deploy the one-minute schedule with checks disabled by default.
- [x] Verify real signed delivery and its persisted terminal run/attempt.
- [x] Activate automatic checks with the owner.
- [x] Fix repeated unknown/idle transitions during continuously successful empty scans.
- [x] Persist scan state atomically, stabilize two complete empty scans and reject stale revisions.
- [x] Implement one atomic outbox/recipient snapshot per idle epoch; owner activation is verified.
- [x] Add signed activity ingestion and invalidate in-flight scans on fresh activity.
- [x] Activate continuous monitoring and idle-alert readiness after real test delivery verification.
- [x] Regression-test duplicate/late events, pagination, restarts and access loss in workerd/D1.

## 4. Push and PWA readiness

- [x] Implement owner-only device registration/removal with encrypted credentials.
- [x] Implement an explicit test push, fixed messages and safe notification clicks.
- [x] Deploy device setup and privately install validated server keys.
- [x] Verify registration and actual Vivaldi receipt on Windows 11 (browser/PWA).
- [x] Verify Android Vivaldi receipt in the notification shade; foreground banners differ.
- [x] Verify Linux Mint/Firefox registration, test receipt and visible notification tap-to-open.
- [ ] Complete remaining cross-device background/lock-screen acceptance.
- [x] Implement standards-based Web Push and stable per-epoch notification tags.
- [x] Implement bounded per-device idle retries and expiry/renewal fencing.
- [x] Implement canonical run-attempt links for completed activity, regardless of conclusion.
- [x] Deploy automatic idle alerts with registrations preserved and activation off.
- [x] Verify owner idle-alert activation in hosted storage.
- [x] Verify real automatic idle receipt on both owner devices.
- [x] Implement app-first notification clicks and a validated GitHub run link.
- [x] Verify test click-through on Edge/Windows and Chrome/Android; owner accepts results and closes Vivaldi-specific work.
- [x] Add immediate tap navigation and local handler/outcome diagnostics for retesting.
- [x] Add PNG/maskable/Apple icons and verify manifest, served dimensions and mask safety in Chromium.
- [ ] Verify refreshed launcher icons and actual install behavior on owner devices.
- [ ] Verify background push on the actual phone and Windows/Linux browsers.
- [ ] iOS: Home Screen install, iOS 16.4+, explicit notification permission.

## 5. Launch

- [x] Prepare main-only gated deployment with full checks, browser smoke, credential preflight and public health verification.
- [x] Owner installs scoped CI credentials, enables gate and verifies first GitHub deployment.

- [x] Configure Cloudflare, production GitHub App and production secrets.
- [ ] Exercise setup/disconnect and live busy-to-idle notifications end to end.
- [ ] Verify the monitor's own CI/CD runs do not create notification loops.
- [x] Enable deployment and verify the first GitHub production release.
- [x] Measure hosted D1 storage/24-hour rows and compare with current pricing.
- [x] Record owner Worker CPU percentiles, zero observed errors and account Free request/event usage.
- [x] Profile local workerd quiet scans and remove demonstrated redundant cryptography with security regressions.
- [ ] Verify deployed-version scheduled CPU against the Free limit; local call reductions are not an edge CPU guarantee.
- [ ] Confirm representative steady-state usage after normal operation.
- [ ] Optional Codex chat links only after a reliable association is available.

The foundation alone is not an acceptance test for the complete product.

## Engineering CI handoff

The user watches CI completion. After starting a run, the engineer shares the
run link and pauses until the user reports it finished. No assistant status
polling, watchers or scheduled engineering-status checks are installed.

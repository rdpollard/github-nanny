# Milestones

## 1. Foundation — implemented

- [x] Versioned requirements and architecture, including scope limitations.
- [x] React/Vite/Worker scaffold with responsive dashboard and explicit demo.
- [x] Preserve GPL license and upstream MIT attribution.
- [x] Unknown-status API until real integration exists.
- [x] Idle-decision function and focused tests for partial scans and races.
- [x] Web manifest/service worker/offline fallback; device checks remain below.
- [x] GitHub Actions checks and deployment workflow disabled until configured.

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
- [ ] Verify a complete live automatic busy-to-idle transition.
- [x] Confirm waiting/requested/pending block idle alongside queued/running.
- [ ] Resolve any coverage fallback outside the configured accounts.

## 3. Confirmed global idle

- [x] Implement scheduled reconciliation, bounded requests, leased scans and backoff.
- [x] Deploy the one-minute schedule with checks disabled by default.
- [x] Verify real signed delivery and its persisted terminal run/attempt.
- [x] Activate automatic checks with the owner.
- [x] Fix repeated unknown/idle transitions during continuously successful empty scans.
- [x] Persist scan state atomically, stabilize two complete empty scans and reject stale revisions.
- [x] Implement one atomic outbox entry per idle epoch; production creation remains disabled.
- [x] Add signed activity ingestion and invalidate in-flight scans on fresh activity.
- [ ] Activate continuous monitoring/outbox readiness after real delivery verification.
- [ ] Test duplicate/late events, pagination, restarts and loss of repository access.

## 4. Push and PWA readiness

- [ ] Authorize device subscription create/delete; no public configuration writes.
- [ ] Implement standards-based Web Push and stable notification tags.
- [ ] Retry transient push failures and expire invalid subscriptions.
- [ ] Link notices to relevant run activity, including failed/cancelled runs.
- [ ] Add final PNG/maskable/apple icons and verify install behavior.
- [ ] Verify background push on the actual phone and Windows/Linux browsers.
- [ ] iOS: Home Screen install, iOS 16.4+, explicit notification permission.

## 5. Launch

- [ ] Configure Cloudflare, production GitHub App and production secrets.
- [ ] Exercise setup/disconnect and live busy-to-idle notifications end to end.
- [ ] Verify the monitor's own CI/CD runs do not create notification loops.
- [ ] Measure expected use/cost, enable deployment and monitor first releases.
- [ ] Optional Codex chat links only after a reliable association is available.

The foundation alone is not an acceptance test for the complete product.

## Engineering CI handoff

The user watches CI completion. After starting a run, the engineer shares the
run link and pauses until the user reports it finished. No assistant status
polling, watchers or scheduled engineering-status checks are installed.

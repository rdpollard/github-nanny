# Scheduled CPU investigation

## Evidence and scope

The owner dashboard reported all-version CPU percentiles above the documented
Free budget, with zero errors. Those figures do not identify current scheduled
invocations or their total billable CPU. The following experiment profiles the
actual built Worker in local workerd through Miniflare's inspector, using only
synthetic credentials, ephemeral D1 and mocked upstream responses.

The baseline runtime matches deployed source `1cb06aa2304618eef6331d73d2f1be92871a3576`.
Both before/after runs settled initial quiet, then executed 12 real scheduled
entries over four public repositories and two installation accounts. Fixtures
also contain 17 excluded private repositories and one registered push device.
Every measured scan completed all 34 GitHub requests. No outbound push occurred.
The RSA key is a synthetic 2048-bit fixture, not a measurement of the production key.

## Observed native cryptography calls across 12 quiet scans

| Operation | Before | After |
| --- | ---: | ---: |
| RSA key import | 24 | 12 |
| RSA App JWT signature | 24 | 12 |
| ECDSA key imports | 24 | 0 |
| ECDSA proof signature | 12 | 0 |
| ECDSA proof verification | 12 | 0 |
| HKDF key import | 12 | 0 |
| HKDF key derivation | 24 | 0 |
| SHA-256 digest | 24 | 0 |
| Total counted calls | 156 | 24 |

That is 13 to 2 counted crypto calls per quiet scan, about 85% fewer calls for
this scenario. It is not an 85% CPU reduction. Sampling also shows substantial
fetch/response-reader and D1 work, which these changes do not remove. Inspector
sampling, local hardware, mock bodies and diagnostic wrappers add variance;
local sampled milliseconds are not Cloudflare's billed CPU measurements.

## Changes

1. A complete access check signs one App JWT and reuses it across its configured
   accounts. This is the App's shared identity, not an installation bearer token.
   The JWT promise lives only inside that check. Each installation still receives
   its own restricted token, every new scan imports/signs again, and an invalid or
   rotated key is not hidden by a process-level cache. The existing setup/auth,
   coverage and request-budget behavior remains intact.
2. Idle dispatch expires at most 50 stale outbox entries and checks for due work
   before importing push keys, verifying the ECDSA pair and deriving storage keys.
   The query is only a work hint. It cannot authorize sending: all existing scope,
   owner, configuration, freshness, recipient/revision and delivery-lease checks
   still run when work exists, including the final check immediately before send.
   Future retries wait until due and use another complete scan as before.

No GitHub coverage requests, visibility rechecks, unfinished statuses, quiet
stabilization, public freshness requirements or delivery authorization were removed.
No long-lived token/key cache or production profiling endpoint was added.

## Reproduce locally

```sh
npm run build
PROFILE_ROUNDS=12 PROFILE_OUTPUT=/tmp/github-nanny-local.cpuprofile node scripts/profile-scheduled.mjs
```

The script uses the existing runtime fixture/Miniflare dependencies and Node 24.
It prints operation counts and top inspector samples; PROFILE_OUTPUT optionally
writes a DevTools-compatible local CPU profile. PROFILE_ROUNDS accepts 1–100.
It uses fixture-only database state to make checks due and settle quiet, never
hosted data. The inspector binds locally and is disposed with the fixture.
Do not substitute production credentials or expose the inspector publicly.

## Validation and remaining hosted check

Regression tests verify a native JWT against both accounts, one signature per
check, fresh authentication under key rotation and failure with a replacement
bad key. Runtime tests verify expired work is removed without push imports or
sends. Existing delivery tests still cover actual encrypted sends, retries,
pause/activity/configuration races and recipient renewal.

A bounded attempt to sample one production scheduled event through the local
Wrangler connection returned unavailable, so no live CPU value was captured.
It did not change runtime settings, enable invocation logs/traces, retain raw
events or create a recurring watcher. No additional credentials were requested.

After this change deploys, select the new version in Cloudflare Metrics and
inspect scheduled CPU/error outcomes over normal operation. Until then, meeting
the Free 10 ms budget is unverified. Retain the current plan; do not infer that
zero historical errors grant a larger limit or authorize an upgrade.

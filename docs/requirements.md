# Product requirements

## Agreed behavior

1. Personal utility for one GitHub account, usable in mobile, Windows, and Linux
   browsers, with PWA installation where supported.
2. Monitor all accessible repositories, all actors, branches, trigger types,
   and concurrent runs. Repository access and webhook coverage are constrained
   by GitHub authorization and installation permissions; expose those limits.
3. Notify after observed activity ends across the entire monitored scope.
   Completed runs count as finished regardless of conclusion.
4. A single global idle notification is sufficient. No failure/cancellation
   alerts or dashboard run history are needed.
5. Send a push as soon as the backend can confirm idle, with a GitHub run link.
6. Only active runs appear on the main dashboard. Show a global busy/idle status,
   last successful check time, and unknown/stale status when confidence is lost.
7. Anyone with the link can view the public dashboard. Owner administration and
   device subscription management use GitHub authorization.
8. Engineer in Codex, keep source in GitHub, use GitHub Actions for CI/CD, and
   deploy to a low-cost managed host. Cloudflare Workers is the chosen target.
9. A link back to a matching Codex chat is optional. Automatic messaging into
   Codex is not a dependency of the MVP and has no verified integration yet.
10. `stormbots/Tactics-Strategy-Dev-Environments` is mandatory alongside the
    personal repositories. Its owner is organization `stormbots` (immutable ID
    `5925283`). A personal installation alone does not meet the requirement.
    Missing organization approval, installation, or repository access must remain
    an explicit coverage gap and cannot support a future global idle assertion.

## Details to settle during integration

- GitHub has nonterminal states beyond queued/running, including requested,
  pending, and waiting for approval. Proposed conservative default: these block
  idle too, since the workflow is unfinished. Confirm that policy before launch.
- Owner installation covers owned repositories; organization/collaborator repos
  may need separate installation or a polling fallback. A coverage gap must be
  visible, not silently treated as inactivity. Sign-in alone cannot grant every
  repository's webhook permissions.
- The user currently monitors public repositories. A future private repository
  must not be exposed automatically through the public dashboard. Handle that
  access change deliberately during integration.
- Number of repositories, run volume, and actual mobile browser determine scan
  cadence, API budget, and final installation/push checks.

## Notification acceptance criteria

- First empty sync: no notification.
- Existing or newly observed active runs: arm the next idle transition.
- Last run completes, fails, or is cancelled: reconcile all covered repositories.
- Other runs remain: no notification.
- Complete fresh scan finds none: create one notice for that activity period.
- Repeat completion delivery/reconciliation: no new notice for the same period.
- New run during a scan: invalidate the scan and check again.
- Scan fails, rate limits, loses access, or omits pages: show unknown/stale and
  defer the notice until scope and freshness can be confirmed.
- Offline UI: no cached assertion that GitHub is currently idle.

Push delivery is best effort through browser/OS services; the backend can target
prompt dispatch, not guarantee when a device displays an alert.

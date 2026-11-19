# Upstream evaluation

Source: https://github.com/cheney-yan/github-workflow-dashboard

Reviewed commit: `8b18dcb6a8bee77c3f70cd1894926d444867c240`.

The MIT license permits adaptation with notice preservation. This project keeps
its existing GPL v3 license and retains the upstream MIT notice separately.

## Reuse

Reuse ordinary React UI components, the visual treatment of workflow badges,
repository cards, compact mode and themes. Track copied/adapted files in
THIRD_PARTY_NOTICES.md. New application wiring uses React/Vite on Cloudflare.

## Replace

- The upstream workflow context fetches 50 recent runs and keeps only the newest
  run per workflow ID. That can omit an older still-running instance.
- Monitoring is browser polling, so it is not a background service after closing
  the page. No global idle outbox, push service or PWA implementation was found.
- Upstream manually supplied tokens and browser-local encrypted storage do not
  fit a public dashboard backed by owner-managed credentials. Encryption derives
  its key from browser attributes, which can change and are not a secret boundary.
- The 853-line dashboard component mixes UI, counters and account state; only
  selected presentation code is imported here.
- Next.js has duplicate `.js`/`.ts` configs, and Docker/static-export assumptions
  need cleanup if that framework is retained. Vite avoids carrying these over.
- Tests are mixed: real unit tests exist, while some so-called integration tests
  print success checklists without exercising those behaviors. Tests were read,
  not executed during the upstream evaluation.

No source or credentials from upstream users are copied. Pinning the reviewed
commit keeps attribution and future comparisons reproducible.

# Third-party notices

Selected files are reused/adapted from
[GitHub Workflow Dashboard](https://github.com/cheney-yan/github-workflow-dashboard)
at commit `8b18dcb6a8bee77c3f70cd1894926d444867c240`.

Copyright (c) 2026 Cheney Yan. Licensed under MIT. The full notice is retained in
[licenses/github-workflow-dashboard.txt](licenses/github-workflow-dashboard.txt).

| File here | Origin |
| --- | --- |
| src/components/ui/card.tsx | src/components/ui/card.tsx |
| src/components/ui/button.tsx | src/components/ui/button.tsx |
| src/lib/utils.ts | src/lib/utils.ts |
| src/components/StatusBadge.tsx | WorkflowStatusBadge in src/components/workflow-dashboard.tsx |

Layout ideas (summary cards, repository grouping and compact view) also follow
that project. New wiring and backend code are covered by this project's LICENSE.
Dependencies retain their own licenses through npm distributions and lockfile.

Web Push encryption and VAPID authentication use
[@block65/webcrypto-web-push](https://github.com/block65/webcrypto-web-push)
2.0.0 (MIT), with uint8array-extras 1.6.0 (MIT). Their full notices are retained
in [licenses/webcrypto-web-push.txt](licenses/webcrypto-web-push.txt) and
[licenses/uint8array-extras.txt](licenses/uint8array-extras.txt).

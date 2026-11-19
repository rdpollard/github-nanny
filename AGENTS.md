# Working on GitHub Nanny

Read README.md and docs/architecture.md before changing monitoring behavior.
Use Node 24+, `npm ci`, and `npm run check`. Keep package-lock.json in sync.

## CI handoff

The user coordinates CI completion. After an action starts a GitHub Actions run
(opening a PR, pushing to an open PR, or merging), obtain its run URL once, share
the link with the user, and pause engineering until they say it has finished.
Do not poll CI status, run `gh pr checks --watch` / `gh run watch`, install status
watchers, or set up scheduled GitHub status checks for the engineering workflow.
After the user reports completion, inspect the result/logs as needed and resume.
Run local checks before publishing a change so CI can be handed off once.

## Implementation

- Distinguish sample data, unknown status, and confirmed idle in every UI path.
- Never establish global idle from a webhook alone, a partial repository list,
  the latest run per workflow, a failed request, or a truncated API page.
- Keep individual runs and attempts distinct. Do not collapse simultaneous
  runs of the same workflow.
- Public dashboard filters must not change the backend's monitoring scope.
- Secrets and GitHub credentials belong in Worker secrets or encrypted server
  storage. Never put them in localStorage, VITE_* variables, logs, or fixtures.
- The public dashboard is read-only. Setup, subscriptions, and configuration
  mutations require owner authorization before live integration is enabled.
- Preserve GPL LICENSE and the MIT notices for reused dashboard components.
- Add focused regression tests for monitoring decisions, retries, and races.
- Keep each PR reviewable and update docs/roadmap.md with implementation status.
- Deployment is gated on repository variable CLOUDFLARE_DEPLOY_ENABLED=true.
  Do not enable it or provision billable resources without user authorization.

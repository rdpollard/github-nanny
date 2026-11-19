# Working on GitHub Nanny

Read README.md and docs/architecture.md before changing monitoring behavior.
Use Node 24+, `npm ci`, and `npm run check`. Keep package-lock.json in sync.

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

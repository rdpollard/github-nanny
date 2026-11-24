# Production GitHub deployment

## Current production behavior

The Deploy workflow is enabled only by repository variable
`CLOUDFLARE_DEPLOY_ENABLED=true` and only on `refs/heads/main`. The owner enabled the gate and verified manual main deployment
in run `45475925420`; see [deployment.md](deployment.md). Main pushes and manual dispatch on main use the same
job: credential presence check, locked dependency install, full unit/runtime
checks and production build, browser smoke, deployment dry run, remote D1
migrations, Worker/assets upload, then a bounded public health check.

The job has a 20-minute timeout, read-only GitHub permissions, SHA-pinned actions
and serialized deployments without canceling an in-flight production release.
It runs its own complete validation; it does not poll/wait for the separate CI
workflow. PRs do not deploy, and manual dispatch on another branch is skipped.
A later workflow failure stops subsequent steps. Migrations already applied
before a failed upload are not automatically reverted; keep migrations compatible
with the preceding Worker. Health success confirms the service responds, not
that every owner/device acceptance check passed.

## Credential setup for a new installation or replacement token

1. Open [Cloudflare Account API tokens](https://dash.cloudflare.com/?to=/:account/api-tokens)
   for account `30d2f3da9cdc70736e8a39392f4dc43c` and create a separate CI token,
   named for example `github-nanny-github-actions`.
2. Grant Workers **Editor** scoped to the existing **github-nanny** Worker.
   The current Cloudflare permission model supports individual Worker scope.
   Grant **D1 Edit/Write** for migration queries in the same account, scoped to
   database `github-nanny` (`c34f0c4b-a637-4ad9-94be-c60f1b0ef9a1`) if the token
   interface offers database scope; otherwise use that account only for D1.
   Binding the existing D1 database alone does not need D1 write access, but
   running migrations does. No Worker Admin or zone/DNS permissions are needed
   for this existing workers.dev deployment.
3. If the dashboard only offers legacy custom-token permissions, the compatible
   account-scoped alternative is **Workers Scripts Edit**, **D1 Edit**, and
   **Account Settings Read**, limited to the one account above. This has broader
   Worker access than per-Worker Editor. Avoid the unmodified Workers template:
   it includes unrelated KV, R2, tail and zone permissions. Do not add permissions
   just to suppress an unexplained failure; inspect the failing command first.
4. In [GitHub Actions secrets](https://github.com/rdpollard/github-nanny/settings/secrets/actions),
   add repository secrets:

   | Name | Value |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | The newly created CI token |
   | `CLOUDFLARE_ACCOUNT_ID` | `30d2f3da9cdc70736e8a39392f4dc43c` |

   Enter the token directly in GitHub, never chat or source. Keep the existing
   Worker application secrets intact. Local Wrangler OAuth is separate and must
   not be copied into CI. Set a token lifetime you can maintain; renew the Actions
   secret before any selected expiry. Dynamic GitHub-hosted runners do not have
   a single stable client IP for an allowlist.
5. After the workflow has merged and credentials are saved, set repository
   variable `CLOUDFLARE_DEPLOY_ENABLED` to `true` in
   [Actions variables](https://github.com/rdpollard/github-nanny/settings/variables/actions).
   Adding the variable alone does not dispatch a workflow.
6. Run [Deploy](https://github.com/rdpollard/github-nanny/actions/workflows/deploy.yml)
   manually with branch **main** for the first validation. Share its run link
   once and follow the user's manual CI completion handoff. Do not start a run
   watcher. Subsequent main pushes deploy automatically with their own checks.

The current connector cannot administer repository Actions secrets, so the owner
must enter these values in GitHub. No paid plan or new resource is required.

## Acceptance and recovery

After the first run completes, inspect every step and the published version.
Check public health/status, current assets and unsigned owner-route rejection.
Use a read-only hosted check to confirm the saved public scope, registrations,
monitoring/alerts and absence of new errors. A release must not reset these.
The normal CI/deployment activity can produce one legitimate idle alert after
all monitored repositories finish; the alert itself never starts a workflow.

If credentials fail, correct the token/secret and rerun Deploy on main. A failed
public health check occurs after upload; inspect the deployment before retrying.
To stop future automatic releases, set the gate to `false`; this does not cancel
an active run or pause Nanny's GitHub monitoring. Use a reviewed revert on main
for a source rollback. Do not roll back D1 migrations automatically or rotate
application secrets as a deployment repair.

## References

- [Cloudflare GitHub Actions setup](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Workers roles, scopes and Wrangler commands](https://developers.cloudflare.com/workers/authorization/workers/)
- [API token permissions, including D1](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)

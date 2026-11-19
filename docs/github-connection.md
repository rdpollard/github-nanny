# GitHub owner connection

This change adds owner identity authorization. Repository discovery, Actions
webhooks, D1 and notifications are separate upcoming changes. A successful
sign-in does not imply that live monitoring is connected. Public status remains
unknown until that pipeline is implemented and synchronized.

The connection code must pass CI and be deployed before these URLs work. The
currently hosted scaffold does not contain these new handlers yet.

## Register the GitHub App

The account owner must register the app at https://github.com/settings/apps/new.
The repository integration cannot create a GitHub App registration on their
behalf. Use these settings:

| Setting | Value |
| --- | --- |
| App name | A unique name, for example `GitHub Nanny rdpollard` |
| Homepage URL | `https://github-nanny.github-nanny.workers.dev/` |
| Callback URL | `https://github-nanny.github-nanny.workers.dev/api/auth/callback` |
| Request user authorization during installation | Disabled; sign in explicitly through `/settings` first |
| Expiring user access tokens | Keep enabled |
| Device flow | Not required |
| Setup URL | `https://github-nanny.github-nanny.workers.dev/settings` |
| Installation access | Only this account (private app) |
| Repository permissions | Actions: read-only; Metadata: read-only |
| Webhooks | Leave inactive until the ingestion handler is implemented |

Request no Contents, Workflows write, repository administration, issue or PR
write permissions. Do not confuse the app's numeric App ID with its Client ID.
GitHub sign-in checks the owner's immutable user ID (`27035363`), not a username
or email address supplied by a browser. Other GitHub accounts are denied.

Identity sign-in and App installation are separate. The installation checkbox
stays off because an unsolicited installation OAuth callback has no browser-bound
state from our login route and must be rejected. The owner signs in on `/settings`
and then uses the installation link; GitHub returns to the Setup URL afterward.

After registration, record the public **Client ID** and the app slug from its
GitHub URL. Generate a **client secret**. The app private key and webhook secret
will be needed for the subsequent installation/tracking milestone, not this one.

## Configure the Worker

Public settings in `wrangler.jsonc`:

- `APP_ORIGIN`: exact HTTPS origin; already set for the hosted Worker.
- `GITHUB_OWNER_ID`: immutable allowed owner ID; already set for this account.
- `GITHUB_CLIENT_ID`: add the app's public Client ID.
- `GITHUB_APP_SLUG`: add the slug from `https://github.com/apps/<slug>`.

Worker secrets (never source, browser storage or VITE_* variables):

- `GITHUB_CLIENT_SECRET`: enter directly into Cloudflare's Worker secret settings
  or the interactive input of `npx wrangler secret put GITHUB_CLIENT_SECRET`.
- `SESSION_SECRET`: a freshly generated, unpadded base64url encoding of 32 random
  bytes. The engineer can generate and install this through protected stdin.
  For a local private shell, generate with
  `node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))'`.
  Do not paste the generated value in chat or a commit.

Use the project's existing Wrangler version and authenticated account. Remember
that `wrangler secret put` creates/deploys a version immediately; configure the
approved code and secrets together, or use the documented version-secret
workflow to stage them. Do not enable automatic deployment before the separate
GitHub Actions deployment credentials are configured (see setup.md).

For local development, copy `.dev.vars.example` to `.dev.vars`, populate it with
development credentials and keep it ignored. APP_ORIGIN must be HTTPS; use a
separate HTTPS development origin and matching callback for actual provider
testing. Unit/workerd/browser checks need no real provider credentials.

`npm run types` generates the Worker environment interface from configuration
and the empty example variable names. `npm run check` verifies the generated
file is current. Do not hand-edit worker-configuration.d.ts.

## Authorization contract

1. `/settings` reads `/api/auth/session` once to determine readiness and identity.
2. `/api/auth/login` creates fresh state and a PKCE verifier, signs a five-minute
   browser-bound cookie and redirects to GitHub with the S256 challenge.
3. `/api/auth/callback` validates the canonical origin, signed state, lifetime,
   duplicate parameters and browser cookie before contacting GitHub.
4. The code exchange posts client credentials and the verifier directly to
   GitHub. Redirects are rejected and responses are bounded to 32 KiB. The access
   token is used only to read the immutable user identity, then discarded.
5. Only the configured owner receives an eight-hour HttpOnly, Secure,
   SameSite=Lax `__Host-` session cookie. No provider token or private profile
   information is serialized into it. The OAuth cookie is cleared on return.
6. `/api/admin/installation` requires that session. The installation link is
   built from a validated configured slug; no caller-controlled return URL is
   accepted. GitHub still manages installation separately from identity sign-in.
7. `POST /api/auth/logout` requires an exact matching Origin and clears the
   browser cookie. GET logout and cross-origin mutation requests are rejected.

All auth responses use no-store caching and no-referrer policy. Cookies are
signed, not encrypted: their identity metadata is not treated as secret. Sessions
are currently stateless; a copied session expires after eight hours, and browser
logout does not revoke copies held elsewhere. Rotate SESSION_SECRET to invalidate
all sessions. Server-side revocation will precede broader account management.

## Validation and activation

Local checks exercise valid sign-in, wrong owner, PKCE, expired/tampered state,
duplicate cookies/parameters, provider failures, bounded responses, session
expiry and CSRF protection. A workerd integration test verifies that the built
Worker signs/verifies cookies in its actual runtime. Browser smoke checks cover
the unconfigured owner screen and keep the public dashboard available.

Once CI has completed and the user reports the result, the next external step is
GitHub App registration and secure client-secret installation. Then deploy the
approved connection code and verify the actual browser authorization flow,
including denial of another account. No scheduled GitHub checks or status
watchers are added by this milestone.

## References

- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app
- https://developers.cloudflare.com/workers/examples/signing-requests/
- https://developers.cloudflare.com/workers/observability/logs/workers-logs/#invocation-logs
- https://developers.cloudflare.com/workers/testing/miniflare/writing-tests/

# GitHub owner connection

Owner identity authorization and personal-account repository discovery are
deployed. The owner verified access to `github-nanny`, `locus-tether`, and
`verify`. Organization support for the required `stormbots` repository is
deployed and verified. The owner confirmed 21 accessible repositories: four
public and 17 private, and selected only the four public repos for monitoring.
D1 owner sessions and all-device sign-out are deployed and browser-verified; Actions webhooks and
notifications remain upcoming changes. A successful
sign-in does not imply that live monitoring is connected. Public status remains
unknown until that pipeline is implemented and synchronized.

The owner connection code has passed CI, is merged into `main`, and is deployed.
The session signing key and owner-entered `GITHUB_CLIENT_SECRET` are installed.
The real sign-in attempt failed because Workers rejects the fetch redirect mode
used by the exchange. The fix passed CI and is deployed. The owner completed
real browser authorization and confirmed **Signed in as rdpollard**. The owner
installed the App and reports saving Actions/Metadata read access and All
repositories. The personal installation is verified; the required organization
installation is now verified, including the required repository.

## Registered app

The owner registered `gh-nanny` and supplied these public identifiers:

- App: https://github.com/apps/gh-nanny
- Owner settings: https://github.com/settings/apps/gh-nanny
- Client ID: `Iv23liTv0KKizj08FARz`

The Client ID and slug are configured in `wrangler.jsonc`. The personal-account
permissions and callback work. Both configured installations are verified.
No client secret or private key has been sent through chat or committed.

## Register the GitHub App

The account owner must register the app at https://github.com/settings/apps/new.
The repository integration cannot create a GitHub App registration on their
behalf. Use these settings:

| Setting | Value |
| --- | --- |
| App name | A unique name, for example `GitHub Nanny rdpollard` |
| Homepage URL | `https://github-nanny.github-nanny.workers.dev/` |
| Redirect URI (called Callback URL in some GitHub docs) | `https://github-nanny.github-nanny.workers.dev/api/auth/callback` |
| Allow wildcard matching | Disabled |
| Request user authorization during installation | Disabled; sign in explicitly through `/settings` first |
| Expiring user access tokens | Keep enabled |
| Device flow | Not required |
| Setup URL | `https://github-nanny.github-nanny.workers.dev/settings` |
| Installation access | Public App (Any account), required for the separate organization installation; backend accounts remain allowlisted |
| Repository permissions | Actions: read-only; Metadata: read-only |
| Webhooks | Keep inactive until the signed receiver is deployed and its dedicated secret is configured |

Request no Contents, Workflows write, repository administration, issue or PR
write permissions. Do not confuse the app's numeric App ID with its Client ID.
GitHub sign-in checks the owner's immutable user ID (`27035363`), not a username
or email address supplied by a browser. Other GitHub accounts are denied.

In the registration UI, the Redirect URI input is under **Identifying and
authorizing users**. It is separate from Homepage URL and Setup URL. Save the
registration after editing it, then restart sign-in from `/settings` to create
fresh browser state.

Identity sign-in and App installation are separate. The installation checkbox
stays off because an unsolicited installation OAuth callback has no browser-bound
state from our login route and must be rejected. The owner signs in on `/settings`
and then uses the installation link; GitHub returns to the Setup URL afterward.

After registration, record the public **Client ID** and the app slug from its
GitHub URL. Generate a **client secret**. The app private key and webhook secret
will be needed for the subsequent installation/tracking milestone, not this one.

## Prepare installation authentication

Owner identity sign-in and the personal installation are verified. The App was
initially installed without repository permissions; the owner then saved Actions:
read, Metadata: read and All repositories. Organization access is a separate
installation and verification step.

GitHub App API authentication requires its own private key, separate from the
OAuth client secret already installed:

1. Open https://github.com/settings/apps/gh-nanny. In **Credentials → Key pairs**,
   select **New key**. GitHub downloads a PEM file. Some GitHub settings layouts
   label this **Private keys → Generate a private key**.
2. Open the downloaded file in a local text editor and copy its entire contents,
   including the BEGIN/END lines and newlines.
3. In the existing Cloudflare Worker's **Settings → Variables and Secrets**,
   add a **Secret** named `GITHUB_APP_PRIVATE_KEY`. Paste the complete PEM and
   select **Deploy**. Do not send the key through chat or add it to the repo.

The owner reports saving `GITHUB_APP_PRIVATE_KEY`; Wrangler confirms that secret
name is present without reading its value. The new backend accepts GitHub's
PKCS#1 PEM keys and unencrypted PKCS#8, with signing tested in workerd. The real
key and personal installation are now verified. D1 session storage is deployed;
webhook ingestion and scheduling are not active.

## Check repository access after deployment

1. Sign in on `/settings` and select **Check repository access**.
2. The backend verifies each configured installation and read permissions,
   requests separate short-lived tokens, and reads every repository page.
3. Confirm the personal account uses **All repositories**, and `stormbots` lists
   the required `Tactics-Strategy-Dev-Environments` repository.
   Private names are omitted; a private count is visible only to the owner.

The result covers only configured accounts, not every collaborator repository
the user can access elsewhere. A selected organization installation is sufficient
when it includes every configured required public repository. A selected personal
installation remains a coverage gap. Missing installations or required
repositories keep the overall result incomplete even if the personal inventory
succeeds. Changing, truncated or over-budget inventories are rejected for that
account. There is a shared 40-request budget and a 20-page limit per account;
larger scopes will need the planned batch/reconciliation pipeline.

## Required stormbots organization access

The production scope requires `stormbots/Tactics-Strategy-Dev-Environments`.
The personal installation cannot grant access or webhook coverage for that
organization's repositories. Use a separate organization installation:

1. Open https://github.com/settings/apps/gh-nanny, choose **Advanced**, and
   **Make public** if the App is private. This enables installation on other
   accounts; Marketplace publication is optional. Keep owner sign-in restricted
   to the existing immutable owner ID.
2. Open https://github.com/apps/gh-nanny/installations/new and choose `stormbots`.
3. Select **Only select repositories**, including
   `Tactics-Strategy-Dev-Environments`, with Actions: read and Metadata: read.
   An organization owner may need to approve the installation under its policy.
4. After the organization-support code is deployed, repeat **Check repository
   access**. Both configured accounts must be verified and the required
   repository must appear before calling the configured scope complete.

`GITHUB_ORGANIZATIONS` is a source-controlled JSON list of organization IDs,
logins, and required public repository names. It currently contains organization
ID `5925283`, login `stormbots`, and the required name above. Up to four
organizations are supported, with at most 50 required names each. Responses are
validated against immutable IDs. Other accounts installing the public App are
ignored, and a browser query cannot expand this list. No new key or OAuth
credentials are required solely for this additional installation.

The UI makes no periodic requests to this endpoint. No Actions run or job status
is queried, and no monitor configuration is written. A failed retry clears the
old inventory. Public status stays unknown/unconnected until the actual
monitoring pipeline is implemented. Webhooks must remain inactive.

## Save or disconnect the public scope

The saved-scope change is deployed and owner-verified. The owner can use **Save public scope** to
run a new access verification and
persist only public repositories from all configured accounts. This is separate
from **Check repository access**, which still only displays a report. No supplied
browser inventory is trusted. Incomplete, empty or over-200-public-repository
scopes are rejected without changing the saved record.

**Reload saved scope** reads D1 without contacting GitHub. **Disconnect saved
scope** clears it, leaves identity sign-in and the App installation intact, and
invalidates older in-flight saves. If two devices save concurrently, only one
can replace a particular revision; reload after a conflict. Changes to server
coverage configuration require fresh verification before a saved scope is usable.

Private names/counts and tokens are not stored in the scope document. Saving
does not start Actions queries, webhooks, scheduled monitoring or push. Public
status remains unknown until the live pipeline is implemented. Future monitoring
must revalidate visibility and access rather than trust this saved snapshot.

## Manually check Actions

**Check Actions now** is deployed and owner-verified with an empty result across
the four public repositories. Nonempty live results still need verification.
The button requires a saved scope and performs a fresh installation/access check,
then reads all pages of queued, running, requested, waiting and pending runs in
those public repositories. It does not limit branches, actors or event types.
Run links include the attempt number. No new GitHub App permissions or secrets
are needed: Actions read and Metadata read are already configured.

No Actions request runs automatically on page load, scope save or reload. The
result is an owner-only snapshot with a check time, not a public monitoring feed.
The durable-state change persists sanitized observations and internal quiet
period state but leaves notification creation disabled. It is deployed and
awaits an owner-triggered check to verify persistence on the live host.
No partial result is shown after an error, lost access or scope change. An empty
check does not confirm public global idle or send a notification. Private repository
activity is excluded. Webhooks and scheduled checks remain inactive.

## Signed webhook setup

The receiver is implemented but awaits CI/deployment. Follow
[webhook setup](webhooks.md) after deployment to configure the dedicated shared
secret, webhook URL and event subscriptions. Existing sign-in redirect settings,
read-only permissions and App key remain in use. Receiving signed events alone
does not enable scheduled monitoring or notifications.

## Configure the Worker

Public settings in `wrangler.jsonc`:

- `APP_ORIGIN`: exact HTTPS origin; already set for the hosted Worker.
- `GITHUB_OWNER_ID`: immutable allowed owner ID; already set for this account.
- `GITHUB_CLIENT_ID`: registered app's public Client ID; already set.
- `GITHUB_APP_SLUG`: registered app slug `gh-nanny`; already set.
- `GITHUB_ORGANIZATIONS`: explicit organization allowlist and required public
  repository names; already set for `stormbots` in source control.

Worker secrets (never source, browser storage or VITE_* variables):

- `GITHUB_CLIENT_SECRET`: enter directly into Cloudflare's Worker secret settings
  or the interactive input of `npx wrangler secret put GITHUB_CLIENT_SECRET`.
  For the dashboard, open https://dash.cloudflare.com/30d2f3da9cdc70736e8a39392f4dc43c/workers/services/view/github-nanny/production/settings
  and add it under Variables and Secrets with type Secret. Obtain the value
  using Generate a new client secret in the app's GitHub settings above. Do not
  send it through chat. This configures the hosted Worker, not GitHub Actions.
- `SESSION_SECRET`: a freshly generated, unpadded base64url encoding of 32 random
  bytes. The engineer can generate and install this through protected stdin.
  For a local private shell, generate with
  `node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))'`.
  Do not paste the generated value in chat or a commit.
- `GITHUB_APP_PRIVATE_KEY`: the complete GitHub App PEM key, as described above.
  This is separate from the OAuth client secret and must stay a Worker Secret.

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
file is current. Full runtime declarations are generated by the pinned Wrangler
version to type D1 bindings. Do not hand-edit worker-configuration.d.ts.

## Authorization contract

1. `/settings` reads `/api/auth/session` once to determine readiness and identity.
2. `/api/auth/login` creates fresh state and a PKCE verifier, signs a five-minute
   browser-bound cookie and redirects to GitHub with the S256 challenge.
3. `/api/auth/callback` validates the canonical origin, signed state, lifetime,
   duplicate parameters and browser cookie before contacting GitHub.
4. The code exchange posts client credentials and the verifier directly to
   GitHub. Both provider requests use manual redirect mode; 3xx responses are
   rejected and responses are bounded to 32 KiB. The access
   token is used only to read the immutable user identity, then discarded.
5. Only the configured owner receives an eight-hour HttpOnly, Secure,
   SameSite=Lax `__Host-` session cookie. The persistent-session change adds a
   random ID and stores its hash in D1 before issuing the cookie. Every owner
   request checks that record. No provider token or private profile information
   is serialized into the cookie. The OAuth cookie is cleared on return.
6. `/api/admin/installation` requires that session. The installation link is
   built from a validated configured slug; no caller-controlled return URL is
   accepted. GitHub still manages installation separately from identity sign-in.
7. `POST /api/auth/logout` requires an exact matching Origin, removes the session
   record and clears the cookie. `POST /api/auth/logout-all` removes all sessions
   for this owner. GET logout and cross-origin mutations are rejected.

All auth responses use no-store caching and no-referrer policy. Cookies are
signed, not encrypted: their identity metadata is not treated as secret. After
the persistent-session change is deployed, logout invalidates copied cookies
through D1. Session checks start on the primary database for current revocation
state. Missing storage or a missing/expired record never falls back to signature
authorization alone. Existing stateless cookies must sign in again once after
this deployment. Rotating SESSION_SECRET also invalidates existing cookies.

Only session hashes and owner/login/lifetime metadata are stored. Raw session
IDs, cookies and GitHub tokens are not stored in the database. Expired records
are removed during successful sign-in. Saved-scope disconnect is separate from
session sign-out and does not delete identity sessions.

## Validation and activation

Local checks exercise valid sign-in, wrong owner, PKCE, expired/tampered state,
duplicate cookies/parameters, provider failures, bounded responses, session
expiry and CSRF protection. A workerd integration test verifies that the built
Worker signs/verifies cookies in its actual runtime. Browser smoke checks cover
the unconfigured owner screen and keep the public dashboard available.

The App is registered and the approved code and secrets are deployed. Real
owner authorization succeeded. Denial of another account is covered in tests
but has not been verified with another real GitHub account. Persistent sessions
passed workerd/D1 tests; the owner verified reauthentication and all-device
logout across normal and private browser sessions after deployment.
No scheduled GitHub checks or status watchers are added by this milestone.

## Sign-in failure diagnostics

The deployed diagnostic change distinguishes these fixed outcomes:

| Outcome | Meaning and next step |
| --- | --- |
| `state` | Browser state is missing, expired, changed, or unverifiable. Start sign-in again in the same browser; avoid simultaneous sign-in tabs. |
| `credentials` | GitHub returned `incorrect_client_credentials`. Check that the Worker uses a client secret from this App and the matching Client ID. |
| `verification` | GitHub rejected the sign-in code, or the callback code is invalid. Start a fresh sign-in; codes cannot be reused. |
| `callback` | GitHub returned `redirect_uri_mismatch`. Save the exact Redirect URI shown above. |
| `provider` | The exchange failed due to an unavailable, malformed, oversized, or unrecognized response. Retry before changing credentials. |
| `identity` | Token exchange succeeded but fetching/validating the user identity failed. Investigate GitHub API availability or access. |

`configured: true` means required settings pass local format checks. It does not
prove the client secret is correct or that GitHub will accept the exchange.
Authentication logs contain only the fixed `github_signin_failed` event and an
allowlisted outcome. Provider error descriptions, URLs, codes, tokens, secrets
and exception text are never copied into responses or application logs. Unknown
outcome query values are ignored; the browser still verifies the session before
displaying a success notice.

Workers does not support `redirect: 'error'`: it throws before making any
outbound request. The exchange and identity requests must use `manual` and
explicitly reject 3xx responses. The workerd tests exercise the entire callback
with mocked outbound services so Node-only fetch mocks cannot hide this runtime
incompatibility again.

## References

- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app
- https://developers.cloudflare.com/workers/examples/signing-requests/
- https://developers.cloudflare.com/workers/observability/logs/workers-logs/#invocation-logs
- https://developers.cloudflare.com/workers/testing/miniflare/writing-tests/
- https://developers.cloudflare.com/workers/runtime-apis/request/#requestinit
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
- https://docs.github.com/en/rest/apps/apps#get-a-user-installation-for-the-authenticated-app
- https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-app-installation
- https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration#changing-the-visibility-of-a-github-app

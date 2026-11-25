# Synthetic Nanny wait prototype

Issue [#26](https://github.com/rdpollard/github-nanny/issues/26). Development only;
not served by the production Worker and never connected to GitHub or D1. All
results explicitly say synthetic. It cannot prove GitHub idle, approve a merge,
start CI or continue an arbitrary Codex conversation.

Uses Node 24+, pinned MCP SDK 1.32.2 and Zod 4.6.7, installed separately from the
app. Install from the repository root:

```sh
npm ci --prefix tools/wait-prototype
npm test --prefix tools/wait-prototype
npm run test:long --prefix tools/wait-prototype
```

The last command exercises a fake event after 185 seconds through the real SDK
HTTP client in bounded calls. It does not use Codex inference or an API key. It
is optional locally; the short suite runs in CI. Passing either suite proves
protocol mechanics only, not Codex desktop/cloud/mobile compatibility.

## Desktop STDIO connection (Windows first)

Use the PR branch containing this folder, then run the install command above.
Keep your current project worktree separate if it has unrelated edits. In
PowerShell, obtain the actual executable and script paths:

```powershell
(Get-Command node).Source
(Resolve-Path .\tools\wait-prototype\server.mjs).Path
(Get-Location).Path
```

In **Settings → Plugins → MCPs → Add → custom MCP**, enter:

| Field | Value |
| --- | --- |
| Name | `Nanny synthetic wait` |
| Type | STDIO |
| Command to launch | Absolute Node executable path from the first command |
| Arguments | One argument: absolute server.mjs path from the second command |
| Environment variables / passthrough | Leave empty; no GitHub/OpenAI secrets |
| Working directory | Repository root from the third command |

Use actual paths, not literal PowerShell expressions in the settings fields.
The app launches the process; do not start a separate STDIO process in a terminal.
On Linux use `command -v node` and `realpath tools/wait-prototype/server.mjs` for
the corresponding paths. Linux desktop support still needs actual client testing.
Do not claim Windows support from Linux SDK tests.

Save, then start a dedicated test conversation in the same intended execution
mode as real work. Enable the custom MCP if the client requires selection. Confirm
these four tools appear: prepare_synthetic_wait, wait_for_synthetic_idle,
get_synthetic_wait, cancel_synthetic_wait. A visible custom-server form proves
configuration availability only. Tool loading and real continuation remain tests.
If the cloud conversation cannot access the local server, record that limitation;
do not move the real task to a separate SDK thread or expose the server publicly.

### Test A: unattended original-conversation continuation

Paste this into a dedicated test conversation:

> This is a synthetic MCP compatibility test, not GitHub CI. Use only the Nanny
> synthetic tools. Prepare a ticket with a new UUID requestKey and delaySeconds
> 185. Call wait_for_synthetic_idle with maxWaitSeconds 25 until synthetic_idle,
> at most 12 calls or four minutes. Pending is not completion. When it completes,
> say “Synthetic wait resumed once” in this same conversation. Do not query
> GitHub, edit files, merge, deploy, or take other follow-up actions. My manual
> messages remain valid and should interrupt this waiting workflow. If a tool
> fails, report the limitation and stop rather than inventing a result.

Do not type “done” for this first test. Record total elapsed time, pending calls,
final response and whether it appeared in the original thread/environment. This
uses your normal Codex allowance, not separately billed API requests.

### Test B: ordinary manual “done” during waiting

Start a new synthetic 185-second ticket with the same instructions. While it is
waiting, type **done**. The expected agent behavior is to accept your input,
interrupt the pending wait, cancel its ticket and respond immediately through the
manual test path without GitHub queries or real follow-up actions. If the host
requires its normal Stop control, record that fact and the delay; do not silently
mark a locked-out host as passing. A bounded in-flight call may need interruption.

After the original 185-second mark, confirm there is no second continuation. Also
try “done” after automatic completion and a repeated “done”: input must remain
acceptable, but must not restart completed work. The prototype does not enforce
agent-side action deduplication; this test measures actual host/agent behavior.

### Remaining matrix

Record app close, host sleep, reconnect, cancellation, reopening on another device,
network loss and effective tool timeout. Reopening the app does not imply the
old execution survived. Process restart intentionally loses synthetic tickets;
production durability is a later issue, not implemented here. Test web, Android
and VSCodium separately; never infer support from shared account sign-in.

## Loopback Streamable HTTP

For a second local transport test:

```sh
node tools/wait-prototype/server.mjs --http
```

Connect the client's Streamable HTTP option to `http://127.0.0.1:4317/mcp` only
if that client permits local HTTP. Optional `NANNY_PROTOTYPE_PORT` selects a port
between 1024 and 65535. The server binds only 127.0.0.1, rejects other Host headers
and browser Origin headers, limits request bodies, and holds at most eight
process-local sessions/tickets. Idle sessions expire after 15 minutes. Restart
clears all state. No production OAuth has been implemented or validated.

This endpoint has no authentication and is suitable only for a trusted local
machine's synthetic data. Do not tunnel it, forward it publicly, bind 0.0.0.0,
or use it with credentials/real state. Remote HTTPS/OAuth/account compatibility
remains a separate feasibility requirement; loopback success cannot close #26.
Cancellation uses stateful MCP sessions so the standard cancellation notification
can reach the active call; disconnect aborts its asynchronous wait. This is an
isolated SDK harness, not the proposed production stateless Worker design.

## Test report and gate

Record evidence in [the feasibility report](../../docs/codex-wait-feasibility.md).
Never include tokens or raw credentials. A local SDK pass cannot close #26:
subscription access, actual target conversation execution, manual input, remote
connector auth and client lifecycle behavior need measured results. Production
issues #27–#32 remain gated. Existing manual engineering CI handoff is unchanged.

Sources: [official SDK server/transport documentation](https://ts.sdk.modelcontextprotocol.io/server.html)
and [Codex MCP configuration](https://developers.openai.com/codex/mcp).

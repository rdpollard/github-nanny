# Codex wait feasibility — issue #26

Status: prototype implemented; client gate **not passed**. Production integration
remains disabled. See [specification](codex-wait-spec.md) and
[prototype setup and test prompts](../tools/wait-prototype/README.md).

## Evidence and limits

The owner reports Windows 11 and current Linux Mint Cinnamon available, with the
latest Codex desktop app. The supplied desktop settings screenshot visibly offers
STDIO and Streamable HTTP custom MCP types, local command/arguments, environment
fields and working directory. This establishes configuration UI availability;
exact app build, successful connection, tool invocation and thread continuation
have not yet been measured. Do not substitute “latest” for a build in a pass record.

The isolated Node harness has no production imports, credentials, GitHub traffic,
D1 state, OpenAI inference or paid resource provisioning. Its SDK tests exercise
real STDIO/HTTP negotiation, schema rejection, pending/ready distinction, stable
synthetic event replay, idempotency, cancellation, abort/lease release, budgets,
expiry, reconnect and loopback request protections. These are transport/store
mechanics, not evidence of a successful Codex conversation.

During development, stateless per-request HTTP could not route a standard MCP
cancellation notification to an older active request. The prototype uses bounded
stateful local SDK sessions instead. Production transport/cancellation architecture
must be resolved after client tests; do not silently reuse this process-local
harness in the Worker or assume a transport notification wakes a finished turn.

## Measurements

- Short SDK suite: five tests passed on Linux/Node 24.22.1 with SDK 1.32.2,
  covering STDIO and stateful loopback HTTP, including real tool cancellation.
- 185-second HTTP SDK exercise: passed; seven pending calls took approximately
  25.01 seconds each, followed by synthetic_idle on call eight at 185.08 seconds
  total (last call 9.94 seconds). No Codex model or GitHub requests were used.
- Existing application checks passed: 49 unit tests, 62 runtime tests, generated
  types/typechecking and production build. Prototype dependencies remain isolated
  in tools/wait-prototype and its short suite is added to PR/main CI.
- Actual Codex desktop execution: pending owner connection/test.
- HTTP OAuth and subscription-account remote connector support: untested.

## Client acceptance record

| Client/mode | Exact build / OS / account | Tools connect | 185s continuation | Manual done interrupts | Close/sleep/reconnect/switch | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Desktop, intended real execution mode | Owner reports Windows 11, latest desktop, existing subscription; exact build pending | Configuration form seen only | Untested | Untested | Untested | Pending |
| Desktop on Linux Mint | Available OS; app build/install/mode pending | Untested | Untested | Untested | Untested | Pending |
| Web | Pending | Untested | Untested | Untested | Untested | Pending |
| Android | Pending | Untested | Untested | Untested | Untested | Pending |
| VSCodium extension | Pending | Untested | Untested | Untested | Untested | Pending |

For each actual test record date, exact version, account plan, execution host/mode,
approval behavior, tool timeouts, number/duration of calls, original thread
continuation, manual input latency/cancellation controls and final outcome. No
transcripts or credentials are required. Use the synthetic prompts only; manual
“done” never licenses a real merge/deploy in this test.

## Go/no-go

Do not close #26 or start production endpoints/auth/monitor changes until the
specification's feasibility evidence exists. Local STDIO success alone does not
prove a remotely accessible OAuth connector or cross-device operation. If a host
cannot keep the turn active or accept manual input, record unsupported behavior
and preserve manual/push handoff. No API key, paid plan upgrade, UI automation or
new cloud task is an implicit fallback.

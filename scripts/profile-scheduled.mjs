import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { actionsFixture, origin } from '../tests/helpers/actions.mjs';
import { browserSubscription, pushKeys } from '../tests/helpers/push.mjs';

// Local workerd only: synthetic keys, D1 and upstream responses. No production
// credentials, GitHub calls, provider sends or CI status checks are involved.
const rounds = Number(process.env.PROFILE_ROUNDS ?? 12);
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 100);
const f = await actionsFixture({ GITHUB_WEBHOOK_SECRET: 'profile-test-only-'.repeat(3),
  WEB_PUSH_PRIVATE_KEY: JSON.stringify(pushKeys()), PUSH_STORAGE_SECRET: randomBytes(32).toString('base64url') }, { inspectorPort: 0 });
let socket;
try {
  await f.prepare();
  assert.equal((await f.worker.dispatchFetch(`${origin}/api/admin/reconciliation`, { method: 'POST', headers: f.headers })).status, 200);
  const headers = { ...f.headers, 'Content-Type': 'application/json' };
  const subscription = browserSubscription();
  assert.equal((await f.worker.dispatchFetch(`${origin}/api/admin/push`, { method: 'POST', headers,
    body: JSON.stringify({ label: 'Profile fixture', subscription: subscription.value }) })).status, 201);
  assert.equal((await f.worker.dispatchFetch(`${origin}/api/admin/alerts`, { method: 'POST', headers })).status, 200);
  f.control.mode = 'empty';
  f.control.push = () => { throw new Error('A quiet profile must never send push'); };
  const db = await f.worker.getD1Database('DB');
  // Settle initial quiet outside the measurement, using fixture-only clock state.
  assert.equal((await f.scan()).status, 200);
  await db.prepare('UPDATE monitor_state SET empty_since = ?, last_complete_at = ?')
    .bind(Date.now() - 15_000, Date.now() - 15_000).run();
  assert.equal((await f.scan()).status, 200);
  assert.equal((await db.prepare('SELECT phase FROM monitor_state').first()).phase, 'idle');
  const inspector = await f.worker.getInspectorURL();
  const listing = new URL('/json', inspector); listing.protocol = 'http:';
  const targets = await (await fetch(listing)).json();
  const target = targets.find(target => target.id === 'core:user:');
  assert.ok(target, 'Only the local user Worker may be profiled');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local inspector connection timed out')), 10_000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Local inspector connection failed')); }, { once: true });
  });
  let id = 0;
  const pending = new Map();
  let contextId;
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.executionContextCreated') contextId = data.params.context.id;
    if (!data.id) return;
    const callback = pending.get(data.id); pending.delete(data.id);
    if (data.error) callback?.reject(new Error(JSON.stringify(data.error))); else callback?.resolve(data.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Inspector timeout: ${method}`)); }, 10_000);
    pending.set(key, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id: key, method, params }));
  });
  await send('Runtime.enable');
  assert.ok(contextId, 'The Worker execution context must be available');
  const instrumentation = await send('Runtime.evaluate', { contextId, expression: `globalThis.__profileCrypto = {}; for (const method of ['importKey','sign','verify','deriveKey','digest']) { const original = crypto.subtle[method].bind(crypto.subtle); crypto.subtle[method] = (...args) => { const value = args[method === 'importKey' ? 2 : 0]; const algorithm = typeof value === 'string' ? value : value?.name; const key = method + ':' + algorithm; __profileCrypto[key] = (__profileCrypto[key] || 0) + 1; return original(...args); }; }` });
  assert.equal(instrumentation.exceptionDetails, undefined, 'Crypto counting must be installed in the Worker');
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 100 });
  await send('Profiler.start');
  for (let i = 0; i < rounds; i++) {
    await db.prepare('UPDATE monitor_control SET next_scan_at = 0').run();
    f.calls.length = 0;
    await (await f.worker.getWorker()).scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
    assert.equal(f.calls.length, 34);
    assert.equal((await db.prepare('SELECT last_error FROM monitor_control').first()).last_error, null);
  }
  const { profile } = await send('Profiler.stop');
  const counts = await send('Runtime.evaluate', { contextId, expression: 'JSON.stringify(__profileCrypto)', returnByValue: true });
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  const times = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const frame = byId.get(profile.samples[i]).callFrame;
    const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').at(-1)}:${frame.lineNumber + 1}`;
    times.set(key, (times.get(key) ?? 0) + profile.timeDeltas[i]);
  }
  if (process.env.PROFILE_OUTPUT) await writeFile(process.env.PROFILE_OUTPUT, JSON.stringify(profile));
  console.log(JSON.stringify({ rounds, requestsPerScan: 34, cryptoCalls: JSON.parse(counts.result.value),
    topSamples: [...times].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([frame, us]) => ({ frame, sampledMs: +(us / 1000).toFixed(2) })),
    note: 'Local inspector samples and operation counts, not Cloudflare billed CPU or proof of the Free limit.' }, null, 2));
} finally { socket?.close(); await f.worker.dispose(); }

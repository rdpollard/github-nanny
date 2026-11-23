import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, hkdfSync, createDecipheriv } from 'node:crypto';
import { runtimeWorker, storedOwnerCookie } from './helpers/runtime.mjs';
import { pushKeys, browserSubscription, decryptPush, verifyVapid } from './helpers/push.mjs';
import { pushConfig } from '../worker/push/config.ts';
import { DeviceStore } from '../worker/push/devices.ts';
import { pushRoute } from '../worker/push/routes.ts';
import { authConfig } from '../worker/auth/config.ts';

const origin = 'https://nanny.example';
async function fixture(overrides = {}) {
  const keys = pushKeys();
  const storage = randomBytes(32).toString('base64url');
  const bindings = { APP_ORIGIN: origin, GITHUB_OWNER_ID: '27035363', GITHUB_CLIENT_ID: 'Iv1_test_client',
    GITHUB_CLIENT_SECRET: 'test-client-secret-only-for-fixtures', SESSION_SECRET: 'A'.repeat(43), GITHUB_ORGANIZATIONS: '[]',
    WEB_PUSH_PRIVATE_KEY: JSON.stringify(keys), PUSH_STORAGE_SECRET: storage, ...overrides };
  const calls = [];
  const control = { status: 201, headers: {}, onSend: async () => {}, reject: false };
  const worker = await runtimeWorker({ modules: true, scriptPath: 'dist/github_nanny/index.js', compatibilityDate: '2026-11-19', bindings,
    outboundService: async request => {
      calls.push({ url: request.url, headers: Object.fromEntries(request.headers), body: Buffer.from(await request.arrayBuffer()) });
      await control.onSend();
      if (control.reject) throw new Error('private-provider-exception-with-credentials');
      return new Response('private-provider-response-with-credentials', { status: control.status, headers: control.headers });
    } });
  const db = await worker.getD1Database('DB');
  const headers = { Cookie: await storedOwnerCookie(worker, bindings), Origin: origin, 'Content-Type': 'application/json' };
  const request = (method = 'GET', value, test = false, extra = {}) => worker.dispatchFetch(`${origin}/api/admin/push${test ? '/test' : ''}`, {
    method, headers, ...(value ? { body: JSON.stringify(value) } : {}), ...extra });
  const save = async (value = browserSubscription().value, label = 'Fixture phone') => {
    const response = await request('POST', { label, subscription: value }); assert.equal(response.status, 201); return (await response.json()).id;
  };
  const list = async () => (await request()).json();
  const row = id => db.prepare('SELECT * FROM push_devices WHERE id = ?').bind(id).first();
  return { keys, storage, bindings, calls, control, worker, db, headers, request, save, list, row };
}

test('owner push routes enforce authentication, same origin, methods and configuration before any provider request', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('GET', undefined, false, { headers: {} })).status, 401);
    assert.equal((await f.request('POST', {}, false, { headers: { ...f.headers, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await f.request('DELETE', {}, false, { headers: { Cookie: f.headers.Cookie } })).status, 403);
    assert.equal((await f.request('GET', undefined, false, { headers: { ...f.headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await f.request('GET', undefined, true)).status, 405);
    assert.equal((await f.request('POST', {}, false, { headers: { ...f.headers, 'Content-Type': 'text/plain' } })).status, 415);
    const settings = await f.list(); assert.equal(settings.configured, true); assert.equal(settings.applicationServerKey, f.keys.publicKey);
    assert.deepEqual(settings.devices, []); assert.equal(f.calls.length, 0);
    const publicStatus = await (await f.worker.dispatchFetch(`${origin}/api/status`)).text();
    assert.doesNotMatch(publicStatus, /push_devices|privateKey|applicationServerKey|subscription/);
  } finally { await f.worker.dispose(); }
  const missing = await fixture({ WEB_PUSH_PRIVATE_KEY: '' });
  try { assert.equal((await missing.list()).configured, false); assert.equal((await missing.request('POST', {})).status, 503); }
  finally { await missing.worker.dispose(); }
});

test('subscriptions are sanitized and encrypted with authenticated owner/device binding, and owner views disclose no credentials', async () => {
  const f = await fixture();
  try {
    const browser = browserSubscription();
    const id = await f.save({ ...browser.value, ignored_secret: 'unwanted-field' });
    assert.match(id, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(await f.save(browser.value, 'Renamed device'), id);
    const row = await f.row(id);
    assert.doesNotMatch(JSON.stringify(row), /private-fixture-endpoint|p256dh|unwanted-field/);
    const [iv, ciphertext] = row.encrypted.split('.').map(s => Buffer.from(s, 'base64url'));
    const key = hkdfSync('sha256', Buffer.from(f.storage, 'base64url'), Buffer.from('github-nanny-push-v1'), Buffer.from('storage'), 32);
    const cipher = createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`push-device:27035363:${id}:${row.key_id}`)); cipher.setAuthTag(ciphertext.subarray(-16));
    const value = JSON.parse(Buffer.concat([cipher.update(ciphertext.subarray(0, -16)), cipher.final()]).toString());
    assert.deepEqual(value, browser.value);
    const view = await f.list(); assert.equal(view.devices.length, 1); assert.equal(view.devices[0].label, 'Renamed device');
    assert.doesNotMatch(JSON.stringify(view), /private-fixture-endpoint|p256dh|encrypted|privateKey/);
    const differentOwner = new DeviceStore(f.db, await pushConfig(f.bindings), '99');
    assert.deepEqual(await differentOwner.list(), []); await differentOwner.remove(id); assert.ok(await f.row(id));
    const second = await f.save(browserSubscription('https://web.push.apple.com/fixture-other').value);
    await f.db.prepare('UPDATE push_devices SET encrypted = ? WHERE id = ?').bind(row.encrypted, second).run();
    assert.equal((await f.request('POST', { id: second }, true)).status, 409); assert.equal(f.calls.length, 0);
    assert.equal((await f.row(second)).last_result, 'unavailable');
    await f.db.prepare("UPDATE push_devices SET key_id = 'previous-key-generation' WHERE id = ?").bind(id).run();
    assert.equal((await f.list()).devices.find(device => device.id === id).ready, false);
    assert.equal((await f.request('POST', { id }, true)).status, 409); assert.equal(f.calls.length, 0);
  } finally { await f.worker.dispose(); }
});

test('an explicit test uses interoperable encrypted payload/VAPID, targets only the stored endpoint and is rate limited', async () => {
  const f = await fixture();
  try {
    const browser = browserSubscription(); const id = await f.save(browser.value);
    const competing = await Promise.all([
      f.request('POST', { id, endpoint: 'https://evil.example', title: 'GitHub is idle', path: 'https://evil.example' }, true),
      f.request('POST', { id }, true),
    ]);
    assert.equal(competing.filter(response => response.status === 409).length, 1);
    const result = competing.find(response => response.status === 202);
    assert.ok(result);
    assert.equal(result.status, 202); assert.equal((await result.json()).accepted, true);
    assert.equal(f.calls.length, 1); const sent = f.calls[0]; assert.equal(sent.url, browser.value.endpoint);
    assert.equal(sent.headers['content-encoding'], 'aes128gcm'); assert.equal(sent.headers.ttl, '60');
    verifyVapid(sent.headers.authorization, f.keys, sent.url);
    assert.deepEqual(decryptPush(sent.body, browser), { version: 1, kind: 'test', title: 'GitHub Nanny test',
      body: 'Push delivery is working. Automatic idle alerts are not enabled yet.', path: '/' });
    assert.equal((await f.row(id)).last_result, 'accepted');
    assert.equal((await f.request('POST', { id }, true)).status, 409); assert.equal(f.calls.length, 1);
    assert.equal((await f.db.prepare('SELECT notice_enabled FROM monitor_state').first()).notice_enabled, 0);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM idle_outbox').first()).n, 0);
    assert.equal((await f.request('DELETE', { id })).status, 200); assert.equal(await f.row(id), null);
    assert.equal((await f.request('POST', { id }, true)).status, 409); assert.equal(f.calls.length, 1);
  } finally { await f.worker.dispose(); }
});

test('invalid endpoints/keys/labels fail closed and concurrent registrations cannot exceed ten devices', async () => {
  const f = await fixture();
  try {
    const good = browserSubscription().value;
    for (const endpoint of ['https://127.0.0.1/a', 'http://fcm.googleapis.com/a', 'https://fcm.googleapis.com.evil.test/a',
      'https://fcm.googleapis.com:8443/a', 'https://user:password@fcm.googleapis.com/a', 'https://example.test/a']) {
      assert.equal((await f.request('POST', { label: 'test', subscription: { ...good, endpoint } })).status, 400);
    }
    for (const value of [{ ...good, keys: { ...good.keys, auth: 'bad' } }, { ...good, expirationTime: 1 },
      { ...good, keys: { ...good.keys, p256dh: Buffer.from([4, ...new Array(64).fill(0)]).toString('base64url') } }]) {
      assert.equal((await f.request('POST', { label: 'test', subscription: value })).status, 400);
    }
    assert.equal((await f.request('POST', { label: 'bad\nname', subscription: good })).status, 400);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => f.request('POST', { label: `device ${i}`,
      subscription: { ...good, endpoint: `https://fcm.googleapis.com/fcm/send/fixture-${i}` } })));
    assert.equal(results.filter(r => r.status === 201).length, 10); assert.equal(results.filter(r => r.status === 409).length, 2);
    assert.equal((await f.list()).devices.length, 10); assert.equal(f.calls.length, 0);
  } finally { await f.worker.dispose(); }
});

test('provider failures honor backoff, hide responses, reject redirects and expire gone subscriptions', async () => {
  const f = await fixture();
  try {
    for (const status of [302, 401, 429, 503, 404, 410]) {
      const id = await f.save(browserSubscription(`https://fcm.googleapis.com/fcm/send/status-${status}`).value);
      f.control.status = status; f.control.headers = { Location: 'https://evil.example/private', 'Retry-After': '600' };
      const response = await f.request('POST', { id }, true);
      assert.equal(response.status, status === 404 || status === 410 ? 410 : 503);
      assert.doesNotMatch(await response.text(), /private-provider|evil.example|credentials/);
      const row = await f.row(id);
      if (status === 404 || status === 410) assert.equal(row, null);
      else { assert.ok(row.test_not_before >= Date.now() + 590_000); assert.equal(row.last_result, status >= 429 ? 'temporary' : 'rejected'); }
    }
    assert.equal(f.calls.length, 6); assert.ok(f.calls.every(call => call.url.startsWith('https://fcm.googleapis.com/')));
    // Miniflare converts an outbound-service exception into a 500 response.
    // Inject a rejected fetch directly to exercise a genuine network failure
    // with the same production handler, cryptography and real D1 storage.
    const id = await f.save();
    const env = await f.worker.getBindings();
    const request = new Request(`${origin}/api/admin/push/test`, { method: 'POST', headers: f.headers, body: JSON.stringify({ id }) });
    const failed = await pushRoute(request, env, authConfig(env), async () => { throw new Error('private-provider-exception-with-credentials'); });
    assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /credentials|private-provider/);
    assert.equal((await f.row(id)).last_result, 'unavailable');
  } finally { await f.worker.dispose(); }
});

test('a late test response cannot delete a renewed subscription and expired records never send', async () => {
  const f = await fixture();
  try {
    const browser = browserSubscription(); const id = await f.save(browser.value);
    f.control.status = 410;
    f.control.onSend = async () => { await f.save(browser.value, 'Renewed'); };
    assert.equal((await f.request('POST', { id }, true)).status, 410);
    assert.equal((await f.row(id)).label, 'Renewed');
    f.control.onSend = async () => {};
    await f.db.prepare('UPDATE push_devices SET expires_at = 1, test_not_before = 0 WHERE id = ?').bind(id).run();
    assert.equal((await f.request('POST', { id }, true)).status, 410);
    assert.equal(await f.row(id), null); assert.equal(f.calls.length, 1);
  } finally { await f.worker.dispose(); }
});

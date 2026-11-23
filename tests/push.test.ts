import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { pushConfig } from '../worker/push/config.ts';
import { pushRoute } from '../worker/push/routes.ts';
import type { Bindings, AuthConfig } from '../worker/auth/config.ts';

function secrets(): Bindings {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64url');
  return { WEB_PUSH_PRIVATE_KEY: JSON.stringify({ publicKey, privateKey: jwk.d }), PUSH_STORAGE_SECRET: randomBytes(32).toString('base64url') };
}

test('push configuration rejects missing, malformed and mismatched VAPID/storage keys without exposing values', async () => {
  const valid = secrets();
  assert.ok(await pushConfig(valid));
  for (const env of [{}, { ...valid, WEB_PUSH_PRIVATE_KEY: 'not JSON' }, { ...valid, PUSH_STORAGE_SECRET: 'bad' },
    { ...valid, WEB_PUSH_PRIVATE_KEY: JSON.stringify({ ...JSON.parse(valid.WEB_PUSH_PRIVATE_KEY!), privateKey: JSON.parse(secrets().WEB_PUSH_PRIVATE_KEY!).privateKey }) }]) {
    assert.equal(await pushConfig(env), null);
  }
});

test('push body parsing rejects declared/streamed overflow and malformed data before storage or outbound requests', async () => {
  const env: Bindings = { ...secrets(), DB: { withSession: () => ({}) } as unknown as Cloudflare.Env['DB'] };
  const owner = { origin: 'https://nanny.example', ownerId: '27035363' } as AuthConfig;
  const headers = { Origin: owner.origin, 'Content-Type': 'application/json' };
  const call = (request: Request) => pushRoute(request, env, owner, async () => { throw new Error('No outbound request allowed'); });
  assert.equal((await call(new Request(`${owner.origin}/api/admin/push`, { method: 'POST', headers: { ...headers, 'Content-Length': '4097' }, body: '{}' }))).status, 413);
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel() { cancelled = true; } });
  const streamed = new Request(`${owner.origin}/api/admin/push`, { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit);
  assert.equal((await call(streamed)).status, 413); assert.equal(cancelled, true);
  for (const body of ['{', 'null', '[]']) {
    assert.equal((await call(new Request(`${owner.origin}/api/admin/push`, { method: 'POST', headers, body }))).status, 400);
  }
});

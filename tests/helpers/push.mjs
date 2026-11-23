import { createECDH, generateKeyPairSync, randomBytes, hkdfSync, createDecipheriv, createPublicKey, verify } from 'node:crypto';
import assert from 'node:assert/strict';

export function pushKeys() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  return { publicKey, privateKey: jwk.d };
}
export function browserSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/private-fixture-endpoint') {
  const client = createECDH('prime256v1');
  client.generateKeys();
  const auth = randomBytes(16);
  return { client, auth, value: { endpoint, expirationTime: null,
    keys: { p256dh: client.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } };
}
export function decryptPush(body, browser) {
  const buffer = Buffer.from(body);
  assert.equal(buffer.length, 4096);
  assert.equal(buffer.readUInt32BE(16), 4096);
  assert.equal(buffer[20], 65);
  const sender = buffer.subarray(21, 86);
  const shared = browser.client.computeSecret(sender);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), browser.client.getPublicKey(), sender]);
  const ikm = hkdfSync('sha256', shared, browser.auth, info, 32);
  const key = hkdfSync('sha256', ikm, buffer.subarray(0, 16), Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdfSync('sha256', ikm, buffer.subarray(0, 16), Buffer.from('Content-Encoding: nonce\0'), 12);
  const encrypted = buffer.subarray(86);
  const cipher = createDecipheriv('aes-128-gcm', key, nonce);
  cipher.setAuthTag(encrypted.subarray(-16));
  const padded = Buffer.concat([cipher.update(encrypted.subarray(0, -16)), cipher.final()]);
  let end = padded.length - 1;
  while (padded[end] === 0) end--;
  assert.equal(padded[end], 2);
  return JSON.parse(padded.subarray(0, end).toString());
}
export function verifyVapid(header, keys, endpoint) {
  assert.ok(header.startsWith('vapid t='));
  const [jwt, publicPart] = header.slice(8).split(', k=');
  assert.equal(publicPart, keys.publicKey);
  const [head, payload, signature] = jwt.split('.');
  const raw = Buffer.from(keys.publicKey, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.equal(verify('sha256', Buffer.from(`${head}.${payload}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
  assert.equal(JSON.parse(Buffer.from(head, 'base64url')).alg, 'ES256');
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.aud, new URL(endpoint).origin);
  assert.equal(claims.sub, 'https://github.com/rdpollard/github-nanny');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 86400);
}

import { createPrivateKey } from 'node:crypto';

// Ephemeral test-only keys: no production key material is stored in fixtures.
export async function rsaFixture(modulusLength = 2048) {
  const pair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength,
    publicExponent: Uint8Array.from([1, 0, 1]),
  }, true, ['sign', 'verify']);
  const encoded = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const key = createPrivateKey({ key: Buffer.from(encoded), format: 'der', type: 'pkcs8' });
  return {
    pkcs1: key.export({ type: 'pkcs1', format: 'pem' }).toString(),
    pkcs8: key.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey,
  };
}

export async function verifyAppJwt(jwt: string, key: CryptoKey, clientId: string, now: number) {
  const [header, payload, signature] = jwt.split('.');
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
    Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${payload}`));
  const algorithm = JSON.parse(Buffer.from(header, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return valid && algorithm.alg === 'RS256' && algorithm.typ === 'JWT' && claims.iss === clientId &&
    claims.iat === Math.floor(now / 1000) - 60 && claims.exp === Math.floor(now / 1000) + 540;
}

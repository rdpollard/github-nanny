import { base64url } from '../auth/cookies.ts';

// GitHub downloads PKCS#1 RSA keys; Web Crypto imports PKCS#8. Wrap the existing
// DER without reinterpreting its private integers or exposing the key material.
function der(tag: number, content: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const length = content.length;
  const size = length < 128 ? [length] : length < 256 ? [0x81, length] : [0x82, length >> 8, length & 255];
  return Uint8Array.from([tag, ...size, ...content]);
}

function pkcs8(pem: string): Uint8Array<ArrayBuffer> {
  if (pem.length > 16_384) throw new Error('Invalid App key');
  const match = /^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END \1-----$/.exec(pem.trim());
  if (!match) throw new Error('Invalid App key');
  const encoded = match[2].replace(/[\r\n]/g, '');
  const decoded = atob(encoded);
  if (btoa(decoded) !== encoded) throw new Error('Invalid App key');
  const bytes = Uint8Array.from(decoded, value => value.charCodeAt(0));
  if (match[1] === 'PRIVATE KEY') return bytes;
  const rsaAlgorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return der(0x30, Uint8Array.from([0x02, 0x01, 0x00, ...rsaAlgorithm, ...der(0x04, bytes)]));
}

export async function appJwt(clientId: string, pem: string, now = Date.now()): Promise<string> {
  if (!/^[A-Za-z0-9_]{8,100}$/.test(clientId) || !Number.isSafeInteger(now) || now < 60_000) throw new Error('Invalid App configuration');
  const key = await crypto.subtle.importKey('pkcs8', pkcs8(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
  if (algorithm.modulusLength < 2048 || algorithm.modulusLength > 8192) throw new Error('Invalid App key');
  const seconds = Math.floor(now / 1000);
  const encoder = new TextEncoder();
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(encoder.encode(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: clientId })));
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

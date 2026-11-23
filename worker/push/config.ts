import type { VapidKeys } from '@block65/webcrypto-web-push';
import type { Bindings } from '../auth/config.ts';
import { base64url } from '../auth/cookies.ts';

export interface PushConfig { vapid: VapidKeys; storage: CryptoKey; identity: CryptoKey; keyId: string; }
export const encode = base64url;
export function decode(value: unknown, length?: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 8192) throw new Error('Invalid push encoding');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
  if (encode(bytes) !== value || (length !== undefined && bytes.length !== length)) throw new Error('Invalid push encoding');
  return bytes;
}
export async function fingerprint(value: string): Promise<string> {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

export async function pushConfig(env: Bindings): Promise<PushConfig | null> {
  try {
    if (!env.WEB_PUSH_PRIVATE_KEY || !env.PUSH_STORAGE_SECRET) return null;
    const value: { publicKey: string; privateKey: string } = JSON.parse(env.WEB_PUSH_PRIVATE_KEY);
    const publicBytes = decode(value.publicKey, 65);
    decode(value.privateKey, 32);
    const storageBytes = decode(env.PUSH_STORAGE_SECRET, 32);
    if (publicBytes[0] !== 4) return null;
    const algorithm = { name: 'ECDSA', namedCurve: 'P-256' };
    const publicKey = await crypto.subtle.importKey('raw', publicBytes, algorithm, false, ['verify']);
    const privateKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: value.privateKey,
      x: encode(publicBytes.slice(1, 33)), y: encode(publicBytes.slice(33)) }, algorithm, false, ['sign']);
    const proof = new TextEncoder().encode('GitHub Nanny Web Push configuration');
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, proof);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, proof)) return null;
    const root = await crypto.subtle.importKey('raw', storageBytes, 'HKDF', false, ['deriveKey']);
    const derivation = (purpose: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('github-nanny-push-v1'), info: new TextEncoder().encode(purpose) });
    return { vapid: { publicKey: value.publicKey, privateKey: value.privateKey, subject: 'https://github.com/rdpollard/github-nanny' },
      storage: await crypto.subtle.deriveKey(derivation('storage'), root, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
      identity: await crypto.subtle.deriveKey(derivation('identity'), root, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']),
      keyId: await fingerprint(`${value.publicKey}:${env.PUSH_STORAGE_SECRET}`) };
  } catch { return null; }
}

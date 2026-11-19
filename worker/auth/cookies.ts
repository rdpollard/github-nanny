const encoder = new TextEncoder();
export const SESSION_COOKIE = '__Host-github-nanny-session';
export const OAUTH_COOKIE = '__Host-github-nanny-oauth';
export const SESSION_SECONDS = 8 * 60 * 60;
export const OAUTH_SECONDS = 5 * 60;

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0));
  if (base64url(bytes) !== value) throw new Error('Non-canonical encoding');
  return bytes;
}

function key(secret: string) {
  return crypto.subtle.importKey('raw', decode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
}

export async function signCookie(payload: object, secret: string): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

export async function readSignedCookie(value: string | null, secret: string): Promise<Record<string, unknown> | null> {
  if (!value || value.length > 3072) return null;
  try {
    const parts = value.split('.');
    if (parts.length !== 2 || decode(parts[1]).length !== 32) return null;
    if (!await crypto.subtle.verify('HMAC', await key(secret), decode(parts[1]), encoder.encode(parts[0]))) return null;
    const result: unknown = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    return result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : null;
  } catch { return null; }
}

// Verify a provided nonce through HMAC rather than comparing secret strings.
export async function matchesNonce(provided: string, expected: string, secret: string): Promise<boolean> {
  const hmac = await key(secret);
  const signature = await crypto.subtle.sign('HMAC', hmac, encoder.encode(expected));
  return crypto.subtle.verify('HMAC', hmac, signature, encoder.encode(provided));
}

export function cookieValue(request: Request, name: string): string | null {
  const matches = (request.headers.get('Cookie') ?? '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}

export function setCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie(name: string): string {
  return setCookie(name, '', 0);
}

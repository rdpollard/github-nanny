import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { randomToken, SESSION_COOKIE, SESSION_SECONDS, signCookie } from '../../worker/auth/cookies.ts';

const migration = await readFile(new URL('../../migrations/0001_owner_sessions.sql', import.meta.url), 'utf8');

export async function runtimeWorker(options, migrate = true) {
  const worker = new Miniflare(convertV4MiniflareOptions({ ...options, d1Databases: { DB: 'test-owner-sessions' } }));
  try {
    if (migrate) {
      const database = await worker.getD1Database('DB');
      // This controlled migration contains no semicolons inside string values.
      await database.batch(migration.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => database.prepare(sql)));
    }
    return worker;
  } catch (error) { await worker.dispose(); throw error; }
}

export async function storedOwnerCookie(worker, bindings, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const sid = randomToken();
  const database = await worker.getD1Database('DB');
  // Seed independently of the production store, which is exercised by the
  // actual OAuth callback tests. Keep raw IDs out of the SQL record.
  await database.prepare('INSERT INTO owner_sessions (session_hash, owner_id, login, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(createHash('sha256').update(sid).digest('hex'), bindings.GITHUB_OWNER_ID, 'rdpollard', iat, iat + SESSION_SECONDS).run();
  const value = await signCookie({ purpose: 'owner-session', sub: bindings.GITHUB_OWNER_ID, login: 'rdpollard', sid, iat, exp: iat + SESSION_SECONDS }, bindings.SESSION_SECRET);
  return `${SESSION_COOKIE}=${value}`;
}

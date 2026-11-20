export interface SessionStore {
  create(id: string, owner: string, login: string, issued: number, expires: number): Promise<void>;
  active(id: string, owner: string, login: string, issued: number, expires: number, now: number): Promise<boolean>;
  revoke(id: string, owner: string): Promise<void>;
  revokeAll(owner: string): Promise<void>;
}

export async function sessionHash(id: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export class DatabaseSessions implements SessionStore {
  private readonly database: Cloudflare.Env['DB'];

  constructor(database: Cloudflare.Env['DB']) { this.database = database; }

  async create(id: string, owner: string, login: string, issued: number, expires: number) {
    const database = this.database.withSession('first-primary');
    const hash = await sessionHash(id);
    const result = await database.batch([
      database.prepare('DELETE FROM owner_sessions WHERE expires_at <= ?').bind(issued),
      database.prepare('INSERT INTO owner_sessions (session_hash, owner_id, login, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(hash, owner, login, issued, expires),
    ]);
    if (result.some(statement => !statement.success)) throw new Error('Session storage unavailable');
  }

  async active(id: string, owner: string, login: string, issued: number, expires: number, now: number) {
    // Start on the primary so a copied cookie cannot bypass a recent revocation
    // via a stale replica. No database object is shared between requests.
    const database = this.database.withSession('first-primary');
    const row = await database.prepare('SELECT session_hash FROM owner_sessions WHERE session_hash = ? AND owner_id = ? AND login = ? AND issued_at = ? AND expires_at = ? AND expires_at > ? LIMIT 1')
      .bind(await sessionHash(id), owner, login, issued, expires, now).first<{ session_hash: string }>();
    return row !== null;
  }

  async revoke(id: string, owner: string) {
    const database = this.database.withSession('first-primary');
    const result = await database.prepare('DELETE FROM owner_sessions WHERE session_hash = ? AND owner_id = ?')
      .bind(await sessionHash(id), owner).run();
    if (!result.success) throw new Error('Session storage unavailable');
  }

  async revokeAll(owner: string) {
    const database = this.database.withSession('first-primary');
    const result = await database.prepare('DELETE FROM owner_sessions WHERE owner_id = ?').bind(owner).run();
    if (!result.success) throw new Error('Session storage unavailable');
  }
}

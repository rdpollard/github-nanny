import type { SessionStore } from '../../worker/auth/sessions.ts';

// Dependency stub for authorization unit tests. Actual SQL, hashing, expiry and
// revocation are separately exercised against D1 in workerd integration tests.
export function memorySessions(): SessionStore {
  const records = new Map<string, { owner: string; login: string; issued: number; expires: number }>();
  return {
    async create(id, owner, login, issued, expires) { records.set(id, { owner, login, issued, expires }); },
    async active(id, owner, login, issued, expires, now) {
      const record = records.get(id);
      return !!record && record.owner === owner && record.login === login && record.issued === issued && record.expires === expires && expires > now;
    },
    async revoke(id, owner) { if (records.get(id)?.owner === owner) records.delete(id); },
    async revokeAll(owner) { for (const [id, record] of records) if (record.owner === owner) records.delete(id); },
  };
}

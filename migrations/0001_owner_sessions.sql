CREATE TABLE owner_sessions (
  session_hash TEXT PRIMARY KEY NOT NULL
    CHECK (length(session_hash) = 64 AND session_hash NOT GLOB '*[^0-9a-f]*'),
  owner_id TEXT NOT NULL,
  login TEXT NOT NULL CHECK (length(login) BETWEEN 1 AND 39),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > issued_at)
);

CREATE INDEX owner_sessions_expiration ON owner_sessions(expires_at);
CREATE INDEX owner_sessions_owner ON owner_sessions(owner_id);

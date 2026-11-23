CREATE TABLE push_devices (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  label TEXT NOT NULL,
  key_id TEXT NOT NULL,
  encrypted TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  test_not_before INTEGER NOT NULL DEFAULT 0,
  last_test_at INTEGER,
  last_result TEXT,
  send_token TEXT
);
CREATE INDEX push_devices_owner ON push_devices(owner_id);

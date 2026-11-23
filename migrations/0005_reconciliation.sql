CREATE TABLE monitor_control (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  scope_revision INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  lease_key TEXT,
  lease_expires_at INTEGER NOT NULL DEFAULT 0,
  next_scan_at INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  failures INTEGER NOT NULL DEFAULT 0 CHECK(failures >= 0),
  last_error TEXT,
  last_request_count INTEGER NOT NULL DEFAULT 0
);
INSERT INTO monitor_control (singleton, scope_revision) SELECT singleton, revision FROM monitoring_scope;

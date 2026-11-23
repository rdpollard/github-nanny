ALTER TABLE push_devices ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE alert_control (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  owner_id TEXT,
  key_id TEXT,
  config_id TEXT
);
INSERT INTO alert_control (singleton) VALUES (1);
CREATE TABLE idle_deliveries (
  epoch INTEGER NOT NULL REFERENCES idle_outbox(epoch) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
  device_revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','accepted','rejected','exhausted')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_scan_at INTEGER,
  lease_key TEXT,
  lease_expires_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(epoch, device_id)
);
CREATE INDEX idle_deliveries_due ON idle_deliveries(status, next_attempt_at);

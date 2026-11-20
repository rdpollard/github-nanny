CREATE TABLE webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  scope_revision INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  commit_key TEXT NOT NULL
);
CREATE INDEX webhook_delivery_retention ON webhook_deliveries(received_at);

CREATE TABLE workflow_run_state (
  scope_revision INTEGER NOT NULL,
  repository_id INTEGER NOT NULL,
  run_id INTEGER NOT NULL,
  attempt INTEGER NOT NULL CHECK(attempt > 0),
  status TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0,
  terminal INTEGER NOT NULL DEFAULT 0 CHECK(terminal IN (0, 1)),
  observed_at INTEGER,
  settled_at INTEGER,
  arm_activity INTEGER NOT NULL DEFAULT 0 CHECK(arm_activity IN (0, 1)),
  commit_key TEXT NOT NULL,
  PRIMARY KEY(scope_revision, run_id)
);
CREATE INDEX workflow_run_retention ON workflow_run_state(updated_at, observed_at);

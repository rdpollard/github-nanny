CREATE TABLE monitor_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  scope_revision INTEGER NOT NULL CHECK(scope_revision >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  phase TEXT NOT NULL DEFAULT 'unknown' CHECK(phase IN ('unknown', 'busy', 'idle')),
  activity_observed INTEGER NOT NULL DEFAULT 0 CHECK(activity_observed IN (0, 1)),
  idle_epoch INTEGER NOT NULL DEFAULT 0 CHECK(idle_epoch >= 0),
  empty_since INTEGER,
  last_complete_at INTEGER,
  runs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(runs_json)),
  last_run_url TEXT,
  commit_key TEXT,
  notice_enabled INTEGER NOT NULL DEFAULT 0 CHECK(notice_enabled IN (0, 1))
);
INSERT INTO monitor_state (singleton, scope_revision)
  SELECT singleton, revision FROM monitoring_scope;

CREATE TABLE idle_outbox (
  epoch INTEGER PRIMARY KEY CHECK(epoch > 0),
  scope_revision INTEGER NOT NULL CHECK(scope_revision >= 0),
  created_at INTEGER NOT NULL,
  run_url TEXT NOT NULL
);

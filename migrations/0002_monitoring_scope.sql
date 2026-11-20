-- One atomic public-only scope document. Revisions fence in-flight setup work.
CREATE TABLE monitoring_scope (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  config_key TEXT,
  verified_at TEXT,
  scope_json TEXT CHECK(scope_json IS NULL OR json_valid(scope_json)),
  CHECK((config_key IS NULL AND verified_at IS NULL AND scope_json IS NULL) OR
        (config_key IS NOT NULL AND verified_at IS NOT NULL AND scope_json IS NOT NULL))
);
INSERT INTO monitoring_scope (singleton) VALUES (1);

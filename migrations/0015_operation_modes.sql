CREATE TABLE operation_modes (
  environment TEXT PRIMARY KEY NOT NULL CHECK (environment IN ('local','test','preview','production')),
  mode TEXT NOT NULL CHECK (mode IN ('normal','read-only','maintenance')),
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1 AND version <= 9007199254740991),
  updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
  updated_by TEXT NOT NULL CHECK (length(trim(updated_by)) BETWEEN 1 AND 128),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 512)
);

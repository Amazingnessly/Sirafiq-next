PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES subjects(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subjects_parent ON subjects(parent_id);
CREATE INDEX IF NOT EXISTS idx_subjects_updated ON subjects(updated_at);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('text', 'pdf')),
  current_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resources_subject ON resources(subject_id);
CREATE INDEX IF NOT EXISTS idx_resources_updated ON resources(updated_at);

CREATE TABLE IF NOT EXISTS resource_versions (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size >= 0 AND size <= 26214400),
  r2_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading', 'stored', 'ready', 'failed')),
  extraction_status TEXT NOT NULL DEFAULT 'pending' CHECK(extraction_status IN ('pending', 'ready', 'failed')),
  extraction_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_versions_resource ON resource_versions(resource_id);
CREATE INDEX IF NOT EXISTS idx_versions_status ON resource_versions(status);

CREATE TABLE IF NOT EXISTS extractions (
  version_id TEXT PRIMARY KEY REFERENCES resource_versions(id) ON DELETE CASCADE,
  content_json TEXT NOT NULL,
  char_count INTEGER NOT NULL CHECK(char_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Intentionally present from day one so provenance can be added without changing
-- the core resource model. V0.1 stores page extraction atomically in `extractions`.
CREATE TABLE IF NOT EXISTS resource_chunks (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES resource_versions(id) ON DELETE CASCADE,
  page_number INTEGER,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_version ON resource_chunks(version_id, ordinal);

-- Canonical large-file size and resumable multipart state.
-- The original `size` column had a 25 MiB CHECK constraint. It remains as a
-- legacy compatibility field; `size_bytes` is authoritative from this migration.
ALTER TABLE resource_versions ADD COLUMN size_bytes INTEGER;
ALTER TABLE resource_versions ADD COLUMN upload_mode TEXT NOT NULL DEFAULT 'single' CHECK(upload_mode IN ('single', 'multipart'));
ALTER TABLE resource_versions ADD COLUMN multipart_upload_id TEXT;
ALTER TABLE resource_versions ADD COLUMN multipart_part_size INTEGER;
ALTER TABLE resource_versions ADD COLUMN multipart_parts_json TEXT;

UPDATE resource_versions
SET size_bytes = size
WHERE size_bytes IS NULL;

CREATE INDEX IF NOT EXISTS idx_versions_upload_mode ON resource_versions(upload_mode);

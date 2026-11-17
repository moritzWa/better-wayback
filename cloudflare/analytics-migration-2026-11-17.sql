-- Existing databases only (fresh ones get these columns from analytics.sql). Run once.
ALTER TABLE usage_events ADD COLUMN previews_loaded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_events ADD COLUMN previews_refused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_events ADD COLUMN previews_failed INTEGER NOT NULL DEFAULT 0;

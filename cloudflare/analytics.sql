-- No URLs, IPs, user agents or persistent visitor identifiers.
CREATE TABLE IF NOT EXISTS usage_days (day TEXT PRIMARY KEY, events INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, minute TEXT NOT NULL,
  session TEXT NOT NULL, search TEXT NOT NULL, event TEXT NOT NULL,
  mode TEXT NOT NULL, source TEXT NOT NULL, cache TEXT NOT NULL, duration_ms INTEGER NOT NULL,
  previews_loaded INTEGER NOT NULL DEFAULT 0, previews_refused INTEGER NOT NULL DEFAULT 0, previews_failed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS usage_events_day ON usage_events(day);
-- SQLite serializes writes. The cap is atomic, including concurrent requests.
CREATE TRIGGER IF NOT EXISTS usage_cap BEFORE INSERT ON usage_events
BEGIN
  SELECT CASE WHEN COALESCE((SELECT events FROM usage_days WHERE day = NEW.day), 0) >= 2000 THEN RAISE(IGNORE) END;
END;
CREATE TRIGGER IF NOT EXISTS usage_count AFTER INSERT ON usage_events
BEGIN
  INSERT INTO usage_days(day, events) VALUES (NEW.day, 1)
    ON CONFLICT(day) DO UPDATE SET events = events + 1;
  -- Prune once per active UTC day, with no cron or background service.
  DELETE FROM usage_events WHERE day < date(NEW.day, '-29 days')
    AND (SELECT events FROM usage_days WHERE day = NEW.day) = 1;
  DELETE FROM usage_days WHERE day < date(NEW.day, '-29 days')
    AND (SELECT events FROM usage_days WHERE day = NEW.day) = 1;
END;

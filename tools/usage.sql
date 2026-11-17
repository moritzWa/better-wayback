SELECT day,
  SUM(event = 'page_view') AS app_views,
  COUNT(DISTINCT session) AS tab_sessions,
  SUM(event = 'search_started' AND source = 'user') AS deliberate_searches,
  SUM(event = 'timeline_ready' AND source = 'user') AS deliberate_timelines,
  COUNT(DISTINCT CASE WHEN event = 'timeline_ready' AND (source = 'user' OR mode = 'custom') THEN session END) AS engaged_sessions,
  SUM(event = 'timeline_ready' AND mode = 'custom') AS custom_timelines,
  SUM(event = 'timeline_ready' AND mode = 'demo' AND source = 'automatic') AS automatic_demos,
  SUM(event = 'preview_opened') AS searches_with_preview_click,
  SUM(event = 'search_failed') AS failures,
  SUM(event = 'quota_reached') AS quota_hits
FROM usage_events
WHERE session != '00000000-0000-4000-8000-000000000000'
GROUP BY day ORDER BY day DESC;

SELECT day, events, events >= 2000 AS capped FROM usage_days ORDER BY day DESC;

-- Archive replay health per UTC hour (last 72 hours of data). refused_pct is the share of
-- preview loads archive.org turned away. avg_load_s is the mean of per-search median replay times.
SELECT substr(minute, 1, 13) AS hour_utc,
  COUNT(*) AS searches_reporting,
  SUM(previews_loaded) AS loaded,
  SUM(previews_refused) AS refused,
  SUM(previews_failed) AS gave_up,
  ROUND(100.0 * SUM(previews_refused) / NULLIF(SUM(previews_loaded) + SUM(previews_refused), 0), 1) AS refused_pct,
  ROUND(AVG(NULLIF(duration_ms, 0)) / 1000.0, 1) AS avg_load_s
FROM usage_events
WHERE event = 'preview_health' AND session != '00000000-0000-4000-8000-000000000000'
GROUP BY hour_utc ORDER BY hour_utc DESC LIMIT 72;

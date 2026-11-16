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

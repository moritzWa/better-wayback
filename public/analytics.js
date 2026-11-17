// Tab-scoped, random session IDs. No cookies, fingerprints, URLs or IPs.
export function createAnalytics() {
  let disabled = true, session, active;
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('analytics') === 'off') sessionStorage.setItem('analytics-off', '1');
    if (params.get('analytics') === 'on') sessionStorage.removeItem('analytics-off');
    disabled = !['visualwayback.com', 'www.visualwayback.com', 'visual-wayback.moritzw.workers.dev'].includes(location.hostname)
      || sessionStorage.getItem('analytics-off') === '1' || navigator.webdriver || navigator.globalPrivacyControl === true;
    if (!disabled) {
      session = sessionStorage.getItem('usage-session') || crypto.randomUUID();
      sessionStorage.setItem('usage-session', session);
    }
  } catch { disabled = true; }
  function send(event, context = active, extra) {
    if (disabled || !context || (!extra && context.sent.has(event))) return;
    context.sent.add(event);
    try {
      void fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
        body: JSON.stringify({ id: crypto.randomUUID(), session, search: context.id, event, mode: context.mode, source: context.source, cache: context.cache, duration_ms: Math.min(3600000, Math.max(0, Math.round(performance.now() - context.started))), ...extra }) }).catch(() => {});
    } catch { /* Never break searches. */ }
  }
  const context = (mode, source) => ({ id: crypto.randomUUID(), started: performance.now(), mode, source, cache: mode === 'demo' ? 'yes' : 'unknown', sent: new Set() });
  try { if (!disabled) send('page_view', context('none', 'automatic')); } catch { disabled = true; }
  return {
    begin(mode, source) { try { if (!disabled) { active = context(mode, source); send('search_started'); } } catch { disabled = true; } },
    cache(value) { if (active && active.cache !== 'no') active.cache = value; },
    ready() { send('timeline_ready'); },
    failed(quota = false) { if (active && !active.failed) { active.failed = true; send(quota ? 'quota_reached' : 'search_failed'); } },
    preview() { send('preview_opened'); },
    // Archive replay health: counts only, at most three batches per search.
    previews({ loaded = 0, refused = 0, failed = 0, medianMs = 0 } = {}) {
      const clamp = n => Math.min(200, Math.max(0, Math.round(Number(n) || 0)));
      if (!active || !(loaded || refused || failed) || (active.flushes = (active.flushes || 0) + 1) > 3) return;
      send('preview_health', active, { loaded: clamp(loaded), refused: clamp(refused), failed: clamp(failed), duration_ms: Math.min(3600000, Math.max(0, Math.round(medianMs) || 0)) });
    },
  };
}

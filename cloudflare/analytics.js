const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const events = new Set(['page_view', 'search_started', 'timeline_ready', 'search_failed', 'quota_reached', 'preview_opened']);
const hosts = new Set(['visualwayback.com', 'www.visualwayback.com', 'visual-wayback.moritzw.workers.dev']);

export async function handleAnalytics(request, env) {
  if (new URL(request.url).pathname !== '/api/analytics') return null;
  const done = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  const url = new URL(request.url);
  if (!hosts.has(url.hostname) || request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return done();
  if (!env.ANALYTICS || /bot|crawler|spider|headless|playwright/i.test(request.headers.get('User-Agent') || '')) return done();
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return done();
  try {
    const reader = request.body?.getReader();
    if (!reader) return done();
    let size = 0, parts = [];
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      size += value.length;
      if (size > 1024) { await reader.cancel(); return done(); }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || !uuid.test(data.id) || !uuid.test(data.session) || !uuid.test(data.search) || !events.has(data.event)) return done();
    if (!['demo', 'custom', 'none'].includes(data.mode) || !['automatic', 'user'].includes(data.source) || !['yes', 'no', 'unknown'].includes(data.cache)) return done();
    if (!Number.isInteger(data.duration_ms) || data.duration_ms < 0 || data.duration_ms > 3600000) return done();
    const now = new Date().toISOString();
    await env.ANALYTICS.prepare('INSERT OR IGNORE INTO usage_events (id, day, minute, session, search, event, mode, source, cache, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(data.id, now.slice(0, 10), now.slice(0, 16), data.session, data.search, data.event, data.mode, data.source, data.cache, data.duration_ms).run();
  } catch { /* Analytics is optional, including schema or free-quota failures. */ }
  return done();
}

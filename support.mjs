// Web-standard handler shared by Node and Cloudflare. Never put the address in assets.
const WINDOW = 600;
const LIMIT = 5;
const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
} });
const unavailable = () => reply(503, { error: 'Support email is not configured. Please try again later.' });

export async function handleSupportRequest(request, env = {}) {
  const url = new URL(request.url);
  if (!['/api/support/config', '/api/support/reveal'].includes(url.pathname)) return null;
  const config = url.pathname.endsWith('/config');
  if (request.method !== (config ? 'GET' : 'POST')) return reply(405, { error: 'Method not allowed.' });
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY ||
      !/^[^\s@?&#%:]+@[^\s@?&#%:]+\.[^\s@?&#%:]+$/.test(env.SUPPORT_EMAIL || '') ||
      !env.CACHE?.get || !env.CACHE?.put) return unavailable();
  if (config) return reply(200, { siteKey: env.TURNSTILE_SITE_KEY });
  if (request.headers.get('Origin') !== url.origin ||
      (request.headers.has('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) {
    return reply(403, { error: 'Use the support link on this website.' });
  }
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return reply(415, { error: 'JSON required.' });
  try {
    // CF-Connecting-IP is set by Cloudflare; Node supplies a socket-derived value.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    const hash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
    const key = `support:rate:${Math.floor(Date.now() / (WINDOW * 1000))}:${hash}`;
    const raw = await env.CACHE.get(key);
    const count = raw === null ? 0 : Number(raw);
    if (!Number.isInteger(count) || count < 0 || count >= LIMIT) return reply(429, { error: 'Too many attempts. Try again in 10 minutes.' });
    // KV is eventually consistent, so this is abuse reduction, not a strict global quota.
    if (env.QUOTAS) {
      const quota = await env.QUOTAS.get(env.QUOTAS.idFromName('global')).fetch('https://quota/write', { method: 'POST' });
      if (!quota.ok) return reply(429, { error: 'Support verification is busy. Please try again later.' });
    }
    await env.CACHE.put(key, String(count + 1), { expirationTtl: WINDOW * 2 });
    if (Number(request.headers.get('Content-Length')) > 4096) return reply(413, { error: 'Request too large.' });
    const reader = request.body?.getReader();
    if (!reader) return reply(400, { error: 'Verification required.' });
    let size = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return reply(413, { error: 'Request too large.' }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let body;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply(400, { error: 'Invalid JSON.' }); }
    if (typeof body?.token !== 'string' || !body.token.trim() || body.token.length > 2048) return reply(400, { error: 'Verification required.' });
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', redirect: 'manual', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: body.token, remoteip: ip }),
      signal: AbortSignal.timeout(10000),
    });
    if (!verification.ok) return reply(503, { error: 'Verification is unavailable. Please try again.' });
    const result = await verification.json();
    if (result.success !== true || result.action !== 'support-reveal' || result.hostname !== url.hostname) {
      return reply(403, { error: 'Verification failed or expired. Please try again.' });
    }
    return reply(200, { mailto: `mailto:${env.SUPPORT_EMAIL}` });
  } catch {
    return reply(503, { error: 'Verification is unavailable. Please try again.' });
  }
}

// A single SQLite-backed object. Never use eventually-consistent KV as a lock.
// Only a confirmed browser.close permits a single token-bound refund. Failed
// closes retain the entire reservation, including the remote browser's idle tail.
export const LIMITS = Object.freeze({ browserBudgetMs: 540000, browserReservationMs: 90000, launchCooldownMs: 20000, closeMarginMs: 2000, writes: 400, jobs: 100 });
export function reserve(previous, operation, now = Date.now(), requestedCaptures = 1) {
  const day = new Date(now).toISOString().slice(0, 10);
  const state = previous?.day === day ? { ...previous, reservations: { ...previous.reservations } } : { day, launches: 0, browserMs: 0, reservations: {}, writes: 0, jobs: 0, nextLaunch: previous?.nextLaunch || 0 };
  // Preserve all legacy reservations. Never reset an already-running daily quota.
  state.browserMs ??= (state.launches || 0) * LIMITS.browserReservationMs;
  const tomorrow = Date.parse(day) + 86400000;
  const deny = (message, until = tomorrow) => ({ status: 429, body: { error: message, retryAfter: Math.max(1, Math.ceil((until - now) / 1000)) } });
  let count = Math.max(1, Math.min(8, requestedCaptures));
  // One browser can serve a batch without hitting the launch-rate limit again.
  // Reserve every capture's deadline plus the original launch/idle-tail margin.
  while (count > 1 && (state.browserMs + LIMITS.browserReservationMs + (count - 1) * 25000 > LIMITS.browserBudgetMs || state.writes + count * 2 > LIMITS.writes || now + LIMITS.browserReservationMs + (count - 1) * 25000 >= tomorrow)) count--;
  const reservedMs = LIMITS.browserReservationMs + (count - 1) * 25000;
  const writes = operation === 'render' ? count * 2 : 1;
  if (!['render', 'job', 'write'].includes(operation)) return { status: 400, body: { error: 'Unknown reservation' } };
  if (state.writes + writes > LIMITS.writes) return deny('Daily cache write allowance exhausted. Cached previews remain available.');
  if (operation === 'job' && state.jobs >= LIMITS.jobs) return deny('Daily new timeline allowance exhausted. Try the packaged examples.');
  if (operation === 'render') {
    if (state.browserMs + reservedMs > LIMITS.browserBudgetMs || now + reservedMs >= tomorrow) return deny('Daily free rendering allowance exhausted. Cached previews remain available.');
    if (now < state.nextLaunch) return deny('Free renderer is cooling down. Cached previews remain available.', state.nextLaunch);
    state.launches++;
    state.browserMs += reservedMs;
    const token = crypto.randomUUID();
    state.reservations[token] = { startedAt: now, released: false, reservedMs };
    state.currentLease = token;
    state.nextLaunch = now + reservedMs;
  }
  if (operation === 'job') state.jobs++;
  state.writes += writes;
  return { status: 200, body: { ok: true, ...(operation === 'render' ? { token: state.currentLease, captures: count } : {}) }, state };
}

export function release(previous, token, now = Date.now()) {
  const reservation = previous?.reservations && Object.hasOwn(previous.reservations, token) ? previous.reservations[token] : null;
  if (!reservation || now < reservation.startedAt || previous.day !== new Date(now).toISOString().slice(0, 10)) return { status: 400, body: { ok: false, error: 'Unknown or expired browser reservation' } };
  if (reservation.released) return { status: 200, body: { ok: true, retryAfter: 20 } };
  const reservedMs = reservation.reservedMs || LIMITS.browserReservationMs;
  const chargedMs = Math.min(reservedMs, Math.max(0, Math.ceil((now - reservation.startedAt) / 1000) * 1000) + LIMITS.closeMarginMs);
  const state = { ...previous, reservations: { ...previous.reservations, [token]: { ...reservation, released: true } }, browserMs: previous.browserMs - (reservedMs - chargedMs) };
  // A late release must not clear another request's newer lease.
  // Start timing after confirmed close, conservatively covering launch latency.
  if (state.currentLease === token) state.nextLaunch = now + LIMITS.launchCooldownMs;
  return { status: 200, body: { ok: true, retryAfter: 20 }, state };
}

export class QuotaCoordinator {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const operation = new URL(request.url).pathname.slice(1);
    let token, count = 1;
    if (operation === 'release' || operation === 'render') {
      const body = await request.text();
      if (body.length > 128) return Response.json({ ok: false }, { status: 400 });
      try { const input = body ? JSON.parse(body) : {}; token = input.token; count = input.count ?? 1; } catch { return Response.json({ ok: false }, { status: 400 }); }
      if (operation === 'release' && (typeof token !== 'string' || token.length > 64)) return Response.json({ ok: false }, { status: 400 });
      if (operation === 'render' && (!Number.isInteger(count) || count < 1 || count > 8)) return Response.json({ ok: false }, { status: 400 });
    }
    const result = await this.ctx.storage.transaction(async storage => {
      const previous = await storage.get('budget');
      const result = operation === 'release' ? release(previous, token) : reserve(previous, operation, Date.now(), count);
      if (result.state) await storage.put('budget', result.state);
      return result;
    });
    return Response.json(result.body, { status: result.status, headers: result.status === 429 ? { 'Retry-After': String(result.body.retryAfter) } : {} });
  }
}

export async function quota(env, operation, body) {
  if (!env.QUOTAS) return { ok: false, error: 'Rendering is disabled until the free quota coordinator is configured.', retryAfter: 3600 };
  try {
    const response = await env.QUOTAS.get(env.QUOTAS.idFromName('global')).fetch(`https://quota/${operation}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    return response.ok && data.ok === true ? data : { ...data, ok: false };
  } catch { return { ok: false, error: 'Quota service unavailable. Cached previews remain available.', retryAfter: 300 }; }
}

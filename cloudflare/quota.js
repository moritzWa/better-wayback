// A single SQLite-backed object. Never use eventually-consistent KV as a lock.
// Reservations are never refunded: a failed close can leave a browser idle for 60s.
export const LIMITS = Object.freeze({ launches: 6, browserReservationMs: 90000, writes: 400, jobs: 100 });
export function reserve(previous, operation, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const state = previous?.day === day ? { ...previous } : { day, launches: 0, writes: 0, jobs: 0, nextLaunch: previous?.nextLaunch || 0 };
  const tomorrow = Date.parse(day) + 86400000;
  const deny = (message, until = tomorrow) => ({ status: 429, body: { error: message, retryAfter: Math.max(1, Math.ceil((until - now) / 1000)) } });
  const writes = operation === 'render' ? 2 : 1;
  if (!['render', 'job', 'write'].includes(operation)) return { status: 400, body: { error: 'Unknown reservation' } };
  if (state.writes + writes > LIMITS.writes) return deny('Daily cache write allowance exhausted. Cached previews remain available.');
  if (operation === 'job' && state.jobs >= LIMITS.jobs) return deny('Daily new timeline allowance exhausted. Try the packaged examples.');
  if (operation === 'render') {
    if (state.launches >= LIMITS.launches || now + LIMITS.browserReservationMs >= tomorrow) return deny('Daily free rendering allowance exhausted. Cached previews remain available.');
    if (now < state.nextLaunch) return deny('Free renderer is cooling down. Cached previews remain available.', state.nextLaunch);
    state.launches++;
    state.nextLaunch = now + LIMITS.browserReservationMs;
  }
  if (operation === 'job') state.jobs++;
  state.writes += writes;
  return { status: 200, body: { ok: true }, state };
}

export class QuotaCoordinator {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const operation = new URL(request.url).pathname.slice(1);
    const result = await this.ctx.storage.transaction(async storage => {
      const result = reserve(await storage.get('budget'), operation);
      if (result.state) await storage.put('budget', result.state);
      return result;
    });
    return Response.json(result.body, { status: result.status, headers: result.status === 429 ? { 'Retry-After': String(result.body.retryAfter) } : {} });
  }
}

export async function quota(env, operation) {
  if (!env.QUOTAS) return { ok: false, error: 'Rendering is disabled until the free quota coordinator is configured.', retryAfter: 3600 };
  try {
    const response = await env.QUOTAS.get(env.QUOTAS.idFromName('global')).fetch(`https://quota/${operation}`, { method: 'POST' });
    const data = await response.json();
    return response.ok && data.ok === true ? data : { ...data, ok: false };
  } catch { return { ok: false, error: 'Quota service unavailable. Cached previews remain available.', retryAfter: 300 }; }
}

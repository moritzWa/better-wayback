export const DAY = 86400;
export const CACHE_LIMITS = Object.freeze({ bytes: 800 * 1024 * 1024, legacyBytes: 128 * 1024 * 1024, sites: 4096, maxDays: 90 });
export function retention(previous, now = Date.now(), record = false) {
  const score = Math.min(1000, (previous?.score || 0) * 2 ** (-Math.max(0, now - (previous?.updatedAt || now)) / (14 * DAY * 1000)) + Number(record));
  const demand = Math.round(score);
  const days = demand >= 30 ? 90 : demand >= 10 ? 30 : demand >= 3 ? 14 : 7;
  return { score, updatedAt: now, days };
}

// Conservative upper bound, not an LRU deletion queue. Count every replacement
// again until its old expiration, and failed writes too. At most 92 day buckets.
export function reserveStorage(previous, bytes, ttl, now = Date.now(), key) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || !Number.isInteger(ttl) || ttl < 60 || ttl > CACHE_LIMITS.maxDays * DAY) return { status: 400, body: { error: 'Invalid cache storage reservation' } };
  const today = Math.floor(now / (DAY * 1000));
  const leases = Object.fromEntries(Object.entries(previous?.leases || {}).filter(([, until]) => until > now));
  if (key && leases[key]) return { status: 409, body: { ok: false, error: 'Cache entry was recently updated. Existing previews remain available.', retryAfter: 65 } };
  const buckets = { ...(previous?.buckets || { [today + 8]: CACHE_LIMITS.legacyBytes }) };
  for (const day of Object.keys(buckets)) if (+day <= today) delete buckets[day];
  const used = Object.values(buckets).reduce((sum, n) => sum + n, 0);
  if (used + bytes > CACHE_LIMITS.bytes) return { status: 429, body: { ok: false, error: 'Free cache storage allowance exhausted. Existing previews remain available.', retryAfter: DAY } };
  const expires = Math.ceil((now + ttl * 1000) / (DAY * 1000));
  buckets[expires] = (buckets[expires] || 0) + bytes;
  // Covers KV's same-key write limit and cross-region propagation delay. Only
  // accepted fills add a lease; the 900/day write cap bounds this short map.
  if (key) leases[key] = now + 65000;
  return { status: 200, body: { ok: true, reservedBytes: used + bytes }, state: { buckets, leases } };
}

export const needsRefresh = (saved, ttl, now = Date.now()) => !saved.cacheExpiresAt || (saved.cacheRetentionTtl || 0) < ttl || saved.cacheExpiresAt - now < ttl * 500;
export const retained = (saved, ttl) => ({ ...saved, cacheExpiresAt: Date.now() + ttl * 1000, cacheRetentionTtl: ttl });

import { keyFor } from '../lib.js';
import { quota } from './quota.js';
import { DAY } from './cache-policy.js';

export async function searchRetention(env, url, record = false) {
  const site = keyFor(new URL(url).hostname.replace(/^www\./, ''));
  const result = await quota(env, 'site', { site, record });
  return result.ok && [7, 14, 30, 90].includes(result.days) ? result.days * DAY : 7 * DAY;
}
export async function storeCache(env, entries, ttl, writes = 0) {
  const bytes = entries.reduce((sum, [key, value]) => sum + new TextEncoder().encode(key).byteLength + (typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value.byteLength), 0);
  const key = keyFor(entries.map(([name]) => name).join('\n'));
  const allowed = await quota(env, 'storage', { bytes, ttl, key, writes });
  if (!allowed.ok) return allowed;
  // Never release reservations on uncertain/partial KV writes.
  for (const [key, value] of entries) await env.CACHE.put(key, value, { expirationTtl: ttl });
  return { ok: true };
}

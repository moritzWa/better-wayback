import test from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_LIMITS, DAY, retention, reserveStorage, needsRefresh, retained } from '../cloudflare/cache-policy.js';
import { QuotaCoordinator, LIMITS, reserve } from '../cloudflare/quota.js';

const now = Date.parse('2026-11-16T12:00:00Z');
function coordinator() {
  const values = new Map(); let pending = Promise.resolve();
  const storage = { get: async key => values.get(key), put: async (key, value) => values.set(key, value), delete: async key => values.delete(key), list: async options => new Map([...values].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => key.startsWith(options.prefix) && (!options.startAfter || key > options.startAfter)).slice(0, options.limit)), transaction(run) { const result = pending.then(() => run(storage)); pending = result.catch(() => {}); return result; } };
  const object = new QuotaCoordinator({ storage });
  const call = async (op, input) => { const response = await object.fetch(new Request(`https://quota/${op}`, { method: 'POST', body: JSON.stringify(input) })); return { status: response.status, ...await response.json() }; };
  return { values, call };
}

test('frequency plus recency gives an older popular site more retention than a recent one-off', () => {
  let popular;
  for (let i = 0; i < 30; i++) popular = retention(popular, now + i * 60000, true);
  assert.equal(popular.days, 90);
  assert.equal(retention(undefined, now + DAY * 1000, true).days, 7);
  assert.equal(retention(popular, now + 14 * DAY * 1000).days, 30, 'Demand has a 14-day half-life');
  assert.equal(retention(popular, now + 90 * DAY * 1000).days, 7, 'Once-popular sites do not stay hot forever');
  assert.equal(retention({ score: 1e10, updatedAt: now }, now, true).score, 1000);
  assert.equal(retention({ score: 3, updatedAt: now }, now).days, 14);
  assert.equal(retention({ score: 10, updatedAt: now }, now).days, 30);
});

test('cache renewal promotes frequency tiers immediately but avoids per-view KV rewrites', () => {
  const saved = { ...retained({}, 7 * DAY), cacheExpiresAt: now + 7 * DAY * 1000 };
  assert.equal(needsRefresh(saved, 7 * DAY, now), false);
  assert.equal(needsRefresh(saved, 14 * DAY, now), true);
  assert.equal(needsRefresh(saved, 7 * DAY, now + 4 * DAY * 1000), true);
  assert.equal(needsRefresh({}, 7 * DAY, now), true, 'Legacy records renew once');
});

test('storage accounting survives midnight, counts replacements conservatively and releases only after expiration', () => {
  const first = reserveStorage(undefined, 1234, 90 * DAY, now);
  assert.equal(first.body.reservedBytes, CACHE_LIMITS.legacyBytes + 1234);
  const second = reserveStorage(first.state, 1234, 90 * DAY, now + DAY * 1000);
  assert.equal(second.body.reservedBytes, CACHE_LIMITS.legacyBytes + 2468);
  const expiredLegacy = reserveStorage(second.state, 1, DAY, now + 9 * DAY * 1000);
  assert.equal(expiredLegacy.body.reservedBytes, 2469);
  assert.equal(reserveStorage(second.state, 1, DAY, now + 92 * DAY * 1000).body.reservedBytes, 1);
  assert.equal(reserveStorage(first.state, CACHE_LIMITS.bytes, DAY, now).status, 429);
  for (const [bytes, ttl] of [[-1, 60], [NaN, 60], [1, 0], [1, 91 * DAY], [1.5, 60]]) assert.equal(reserveStorage(undefined, bytes, ttl, now).status, 400);
});

test('atomic storage reservations cannot race beyond the free budget; probes do not consume it', async () => {
  const { call, values } = coordinator();
  const bytes = (CACHE_LIMITS.bytes - CACHE_LIMITS.legacyBytes) / 2;
  const probe = await call('storage', { bytes, ttl: DAY, check: true });
  assert.equal(probe.ok, true); assert.equal(values.has('cache-storage'), false);
  const results = await Promise.all(Array.from({ length: 3 }, () => call('storage', { bytes, ttl: DAY })));
  assert.equal(results.filter(r => r.ok).length, 2);
  assert.equal(results.filter(r => r.status === 429).length, 1);
});

test('atomic fill leases prevent a popular-site stampede while KV changes propagate', () => {
  const key = 'a'.repeat(24);
  const first = reserveStorage(undefined, 1234, 7 * DAY, now, key);
  const collision = reserveStorage(first.state, 1234, 90 * DAY, now + 1000, key);
  assert.equal(collision.status, 409);
  assert.equal(collision.state, undefined, 'Refused renewals do not consume the storage budget');
  const later = reserveStorage(first.state, 1234, 90 * DAY, now + 65000, key);
  assert.equal(later.status, 200);
  assert.equal(later.body.reservedBytes, CACHE_LIMITS.legacyBytes + 2468);
  assert.equal(Object.keys(later.state.leases).length, 1);
  assert.equal(Object.keys(reserveStorage(later.state, 1, DAY, now + 130000).state.leases).length, 0);
});

test('renewal reserves storage and writes together; stampedes and denials spend neither', async () => {
  const { call, values } = coordinator();
  const input = { bytes: 1234, ttl: 7 * DAY, key: 'a'.repeat(24), writes: 2 };
  const results = await Promise.all(Array.from({ length: 30 }, () => call('storage', input)));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(values.get('budget').writes, 2);
  const before = structuredClone(values.get('cache-storage'));
  values.set('budget', { ...values.get('budget'), writes: LIMITS.writes });
  assert.equal((await call('storage', { ...input, key: 'b'.repeat(24) })).status, 429);
  assert.deepEqual(values.get('cache-storage'), before);
});

test('site frequency state is bounded, read-only lookups never increase it, invalid operations fail', async () => {
  const { call, values } = coordinator();
  const site = 'a'.repeat(24);
  for (let i = 0; i < 30; i++) await call('site', { site, record: true });
  assert.equal((await call('site', { site, record: false })).days, 90);
  assert.equal(values.get(`site:${site}`).score <= 30, true);
  values.set('site-count', CACHE_LIMITS.sites);
  assert.equal((await call('site', { site: 'b'.repeat(24), record: true })).days, 7);
  assert.equal(values.has(`site:${'b'.repeat(24)}`), false);
  assert.equal((await call('site', { site: 'https://amd.com/', record: true })).status, 400);
  assert.equal((await call('site', { site, record: 'true' })).status, 400);
  values.set('site-scan', '');
  values.set(`site:${site}`, { score: 30, updatedAt: Date.now() - 100 * DAY * 1000 });
  const replacement = 'c'.repeat(24);
  assert.equal((await call('site', { site: replacement, record: true })).days, 7);
  assert.equal(values.has(`site:${site}`), false, 'Stale counters can make room without deleting cached captures');
  assert.equal(values.has(`site:${replacement}`), true);
  assert.equal(values.get('site-count'), CACHE_LIMITS.sites);
});

test('two-key cache renewal reserves two writes and preserves existing daily usage on rollout', () => {
  const old = { day: '2026-11-16', writes: 399, jobs: 99, browserMs: 500000, nextLaunch: 0 };
  const next = reserve(old, 'write', now, 2);
  assert.equal(next.state.writes, 401);
  assert.equal(next.state.jobs, 99);
  assert.equal(next.state.browserMs, 500000);
  assert.equal(reserve({ ...old, writes: LIMITS.writes - 1 }, 'write', now, 2).status, 429);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, MAX_IMAGE } from '../cloudflare/runtime.js';
import { QuotaCoordinator, LIMITS, reserve } from '../cloudflare/quota.js';
import { keyFor, RENDER_VERSION } from '../lib.js';

class FakeKV {
  values = new Map();
  puts = [];
  async get(key, type) {
    const value = this.values.get(key);
    return value == null ? null : type === 'json' ? JSON.parse(value) : value;
  }
  async put(key, value, options) { this.puts.push({ key, options }); this.values.set(key, value); }
}
function environment() {
  const state = new Map();
  let pending = Promise.resolve();
  const storage = { get: async key => state.get(key), put: async (key, value) => state.set(key, value), transaction(run) { const next = pending.then(() => run(storage)); pending = next.catch(() => {}); return next; } };
  const object = new QuotaCoordinator({ storage });
  return { CACHE: new FakeKV(), BROWSER: {}, ENABLE_RENDERING: 'true', QUOTAS: { idFromName: name => { assert.equal(name, 'global'); return name; }, get: () => ({ fetch: (url, init) => object.fetch(new Request(url, init)) }) }, ASSETS: { fetch: async () => new Response('static') } };
}
const captures = [
  { timestamp: '20000101000000', original: 'https://example.com/', digest: 'one' },
  { timestamp: '20200101000000', original: 'https://example.com/', digest: 'two' },
];
const jobRequest = (body = { url: 'example.com' }) => new Request('https://visualwayback.com/api/jobs', { method: 'POST', body: JSON.stringify(body), headers: { origin: 'https://visualwayback.com' } });
const eventRequest = id => new Request(`https://visualwayback.com/api/jobs/${id}/events`);
const parse = async response => (await response.text()).split('\n\n').filter(Boolean).map(line => JSON.parse(line.slice(6)));
const indexFetch = async () => Response.json([['timestamp', 'original', 'digest'], ...captures.map(c => [c.timestamp, c.original, c.digest])]);
const key = c => keyFor(c.timestamp + c.original + ':' + RENDER_VERSION);
async function save(env, capture) {
  const value = { ...capture, text: 'Archived text', image: `/cache/${key(capture)}.png`, renderVersion: RENDER_VERSION };
  await env.CACHE.put(`capture:${key(capture)}`, JSON.stringify(value), { expirationTtl: 604800 });
  await env.CACHE.put(`image:${key(capture)}`, new Uint8Array([1, 2]), { expirationTtl: 604800 });
}

test('quota reservations survive reset, serialize launches, and never refund failed launches', async () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  let state;
  for (let i = 0; i < LIMITS.launches; i++) {
    const result = reserve(state, 'render', now + i * 90000);
    assert.equal(result.status, 200);
    state = structuredClone(result.state);
    assert.equal(reserve(state, 'render', now + i * 90000 + 1).status, 429);
  }
  assert.equal(reserve(state, 'render', now + 600000).status, 429);
  assert.equal(reserve(state, 'render', now + 86400000).status, 200);
  assert.equal(reserve(undefined, 'render', Date.parse('2026-11-15T23:59:30Z')).status, 429);
  const env = environment();
  const results = await Promise.all(Array.from({ length: 5 }, () => env.QUOTAS.get('global').fetch('https://quota/render', { method: 'POST' })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
});

test('all KV writes share an atomic 400/day cap; jobs cap at 100/day', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  let state;
  for (let i = 0; i < LIMITS.writes; i++) state = reserve(state, 'write', now).state;
  assert.equal(reserve(state, 'write', now).status, 429);
  assert.equal(reserve(state, 'job', now).status, 429);
  state = undefined;
  for (let i = 0; i < LIMITS.jobs; i++) state = reserve(state, 'job', now).state;
  assert.equal(reserve(state, 'job', now).status, 429);
  assert.equal(reserve(state, 'write', now).status, 200);
});

test('static assets never need browser, quota or KV; malformed APIs do not fall through', async () => {
  const handle = createRuntime({ launch: () => assert.fail('browser launch') });
  const env = { ASSETS: { fetch: async () => new Response('static blog/demo') } };
  for (const path of ['/', '/blog/', '/api/demos/stripe', '/demos/amazon/a.png']) {
    const response = await handle(new Request(`https://visualwayback.com${path}`), env);
    // Demos are served asset-first by Wrangler, not runtime API dispatch.
    assert.equal(response.status, path === '/api/demos/stripe' ? 404 : 200);
  }
  assert.equal((await handle(new Request('https://visualwayback.com/api/unknown'), env)).status, 404);
});

test('jobs validate origins/input, fail closed without quotas, and reuse cached jobs without writes', async () => {
  let queries = 0;
  const handle = createRuntime({ fetchArchive: async (...args) => { queries++; return indexFetch(...args); } });
  const env = environment();
  const cross = new Request('https://visualwayback.com/api/jobs', { method: 'POST', body: '{}', headers: { origin: 'https://evil.test' } });
  assert.equal((await handle(cross, env)).status, 403);
  assert.equal((await handle(jobRequest({ url: 'localhost' }), env)).status, 400);
  assert.equal((await handle(jobRequest({ url: 'example.com', from: '2024', to: '2000' }), env)).status, 400);
  assert.equal((await handle(jobRequest(), { CACHE: env.CACHE })).status, 429);
  const first = await handle(jobRequest(), env);
  assert.equal(first.status, 202);
  assert.match((await first.json()).id, /^[a-f0-9]{24}$/);
  assert.equal((await handle(jobRequest(), env)).status, 200);
  assert.equal(queries, 1);
  assert.equal(env.CACHE.puts.length, 1);
  assert.equal(env.CACHE.puts[0].options.expirationTtl, 86400);
});

test('one isolated capture per stream, cached-first replay, explicit delayed continuation, quota retry', async () => {
  const env = environment();
  let launches = 0, closes = 0;
  const handle = createRuntime({ fetchArchive: indexFetch, launch: async () => { launches++; return { close: async () => { closes++; } }; }, render: async (_, capture) => ({ ...capture, text: 'Archived text', png: new Uint8Array([1, 2, 3]) }) });
  const { id } = await (await handle(jobRequest(), env)).json();
  const events = await parse(await handle(eventRequest(id), env));
  assert.deepEqual(events.map(e => e.type), ['index', 'status', 'capture', 'continue']);
  assert.equal(events.at(-1).retryAfter, 90);
  assert.equal(launches, 1);
  assert.equal(closes, 1);
  const retry = await parse(await handle(eventRequest(id), env));
  assert.deepEqual(retry.map(e => e.type), ['index', 'capture', 'error']);
  assert.equal(retry[1].cached, true);
  assert.ok(retry[2].retryAfter > 0);
  assert.equal(launches, 1);
  await save(env, captures[1]);
  delete env.QUOTAS;
  const done = await parse(await handle(eventRequest(id), env));
  assert.deepEqual(done.map(e => e.type), ['index', 'capture', 'capture', 'done']);
  const image = await handle(new Request(`https://visualwayback.com/cache/${key(captures[0])}.png`), env);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.status, 200);
});

test('missing image metadata pairs stay pending; disabled rendering preserves every indexed capture', async () => {
  const env = environment();
  env.ENABLE_RENDERING = 'false';
  const handle = createRuntime({ fetchArchive: indexFetch, launch: () => assert.fail('disabled') });
  const { id } = await (await handle(jobRequest(), env)).json();
  await env.CACHE.put(`capture:${key(captures[0])}`, JSON.stringify({ ...captures[0], image: `/cache/${key(captures[0])}.png`, text: 'text', renderVersion: RENDER_VERSION }));
  const events = await parse(await handle(eventRequest(id), env));
  assert.deepEqual(events.map(e => e.type), ['index', 'error']);
  assert.equal(events[0].captures.length, 2);
});

test('oversized screenshots and render failures never persist partial metadata; browser always closed', async () => {
  for (const failure of [false, true]) {
    const env = environment();
    let closed = 0;
    const handle = createRuntime({ fetchArchive: indexFetch, launch: async () => ({ close: async () => { closed++; } }), render: async (_, capture) => {
      if (failure) throw new Error('Archive returned HTTP 429');
      return { ...capture, text: 'text', png: new Uint8Array(MAX_IMAGE + 1) };
    } });
    const { id } = await (await handle(jobRequest(), env)).json();
    const events = await parse(await handle(eventRequest(id), env));
    assert.equal(events.at(-1).type, 'error');
    assert.equal(closed, 1);
    assert.equal(env.CACHE.puts.length, 1);
    assert.equal(events.at(-1).retryAfter, failure ? 90 : 300);
  }
});

test('archive redirects and oversized indexes fail boundedly with no job persisted', async () => {
  const env = environment();
  const handle = createRuntime({ fetchArchive: async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal);
    return new Response('x'.repeat(512 * 1024 + 1));
  } });
  assert.equal((await handle(jobRequest(), env)).status, 502);
  assert.equal(env.CACHE.puts.length, 0);
});

test('manual archive redirects are rejected without following Location or writing cache', async () => {
  const env = environment();
  let calls = 0;
  const handle = createRuntime({ fetchArchive: async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } });
  } });
  const response = await handle(jobRequest(), env);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Wayback returned 302/);
  assert.equal(calls, 1);
  assert.equal(env.CACHE.puts.length, 0);
});

test('disconnect during launch closes a late browser without rendering or persisting', async () => {
  const env = environment();
  let acquired, started, closed = 0;
  const launching = new Promise(resolve => { started = resolve; });
  const acquisition = new Promise(resolve => { acquired = resolve; });
  const handle = createRuntime({ fetchArchive: indexFetch, launch: async () => { started(); return acquisition; }, render: () => assert.fail('disconnected client must not render') });
  const { id } = await (await handle(jobRequest(), env)).json();
  const abort = new AbortController();
  const response = await handle(new Request(eventRequest(id), { signal: abort.signal }), env);
  await launching;
  abort.abort();
  acquired({ close: async () => { closed++; } });
  const events = await parse(response);
  assert.deepEqual(events.map(e => e.type), ['index', 'status']);
  assert.equal(closed, 1);
  assert.equal(env.CACHE.puts.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, MAX_IMAGE } from '../cloudflare/runtime.js';
import { QuotaCoordinator, LIMITS, reserve, release } from '../cloudflare/quota.js';
import { keyFor, RENDER_VERSION } from '../lib.js';
import { timelineId } from '../cloudflare/social.js';

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

test('shared searches have server-rendered metadata and reuse a genuine cached screenshot without archive calls', async () => {
  const env = environment(); env.PREVIEW_MODE = 'html';
  env.ASSETS.fetch = async request => {
    assert.equal(new URL(request.url).pathname, '/');
    return new Response('<head><title>Generic</title><link rel="canonical" href="https://visualwayback.com/"><meta property="og:title" content="Generic"><meta property="og:url" content="https://visualwayback.com/"></head>', { headers: { 'Content-Security-Policy': "default-src 'self'", etag: 'old', 'content-length': '123' } });
  };
  const handle = createRuntime({ fetchArchive: () => assert.fail('Unfurl must not contact archive'), launch: () => assert.fail('Unfurl must not launch browser') });
  const target = 'https://example.com/';
  const request = new Request(`https://visualwayback.com/?url=${encodeURIComponent(target)}`);
  const cold = await handle(request, env);
  assert.equal(cold.headers.get('cache-control'), 'no-store');
  assert.match(await cold.text(), /og:image" content="https:\/\/visualwayback.com\/icon-512.png/);
  const id = timelineId(target, '', String(new Date().getUTCFullYear()), 8, true);
  await env.CACHE.put(`job:${id}`, JSON.stringify({ captures }));
  await save(env, captures[0]);
  // Missing newest PNG must fall back to an actual existing older capture.
  await env.CACHE.put(`capture:${key(captures[1])}`, JSON.stringify({ ...captures[1], text: 'text', renderVersion: RENDER_VERSION, image: `/cache/${key(captures[1])}.png` }));
  const response = await handle(request, env);
  const html = await response.text();
  assert.match(html, /<title>example.com · Visual Wayback<\/title>/);
  assert.ok(html.includes(`property="og:image" content="https://visualwayback.com/cache/${key(captures[0])}.png"`));
  assert.match(html, /archived 2000-01-01/);
  assert.match(html, /twitter:card/);
  assert.equal((html.match(/property="og:title"/g) || []).length, 1);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('etag'), null);
  assert.equal(response.headers.get('content-security-policy'), "default-src 'self'");
  assert.equal(await (await handle(new Request(request.url, { method: 'HEAD' }), env)).text(), '');
});

test('shared metadata escapes query content, respects settings and leaves invalid URLs static', async () => {
  const env = environment();
  env.ASSETS.fetch = async () => new Response('<head><title>generic</title></head>');
  const handle = createRuntime({});
  const html = await (await handle(new Request('https://visualwayback.com/?url=' + encodeURIComponent('https://example.com/?q="/><script>alert(1)</script>') + '&from=2020&count=16'), env)).text();
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&amp;from=2020&amp;count=16/);
  assert.equal(await (await handle(new Request('https://visualwayback.com/?url=http://localhost'), env)).text(), '<head><title>generic</title></head>');
});

test('packaged example unfurls use their latest archived PNG, not the separately labelled live capture', async () => {
  const env = environment();
  env.ASSETS.fetch = async request => new URL(request.url).pathname.startsWith('/api/demos/') ? Response.json({ captures: [{ image: '/demos/apple/archive.png', timestamp: '20120101000000' }, { image: '/demos/apple/live.png', timestamp: '20260101000000', sourceType: 'live' }] }) : new Response('<head></head>');
  const handle = createRuntime({});
  const html = await (await handle(new Request('https://visualwayback.com/?url=apple.com'), env)).text();
  assert.match(html, /https:\/\/visualwayback.com\/demos\/apple\/archive.png/);
  assert.ok(!html.includes('/live.png'));
});

test('optional screenshot caching warms newest first and reuses PNGs in HTML mode without new archive work', async () => {
  const env = environment(); env.PREVIEW_MODE = 'html'; env.ENABLE_RENDERING = 'false'; env.ENABLE_SCREENSHOT_CACHE = 'true'; env.RENDER_BATCH_SIZE = '8';
  const rendered = [];
  const handle = createRuntime({ fetchArchive: indexFetch, launch: async () => ({ close: async () => {} }), render: async (_, capture) => { rendered.push(capture.timestamp); return { ...capture, requestedTimestamp: capture.timestamp, text: 'Cached rendered text', png: new Uint8Array([1]) }; } });
  const created = await (await handle(jobRequest({ url: 'example.com', previewMode: 'html' }), env)).json();
  assert.equal(created.screenshotCache, true);
  const request = new Request(`https://visualwayback.com/api/jobs/${created.id}/screenshots`);
  const events = await parse(await handle(request, env));
  assert.equal(events.at(-1).type, 'done');
  assert.deepEqual(rendered, [captures[1].timestamp, captures[0].timestamp]);
  const replay = await parse(await handle(eventRequest(created.id), env));
  assert.equal(replay.at(-1).type, 'done');
  assert.equal(replay.filter(e => e.type === 'capture' && e.capture.image && e.cached).length, 4);
  await parse(await handle(request, env));
  assert.equal(rendered.length, 2);
  assert.equal((await env.CACHE.get(`social:${created.id}`, 'json')).timestamp, captures[1].timestamp);
  env.CACHE.values.delete(`job:${created.id}`);
  env.ASSETS.fetch = async () => new Response('<head></head>');
  const shared = await (await handle(new Request('https://visualwayback.com/?url=example.com'), env)).text();
  assert.ok(shared.includes(`/cache/${key(captures[1])}.png`), 'Share image survives the shorter job TTL');
  assert.equal((await handle(new Request(request.url, { headers: { origin: 'https://evil.com' } }), env)).status, 403);
  env.ENABLE_SCREENSHOT_CACHE = 'false';
  assert.equal((await handle(request, env)).status, 404);
});

test('optional screenshot caching fails closed on quota denial without changing HTML availability', async () => {
  const env = environment(); env.PREVIEW_MODE = 'html'; env.ENABLE_SCREENSHOT_CACHE = 'true';
  const handle = createRuntime({ fetchArchive: indexFetch, launch: () => assert.fail('Quota denied') });
  const { id } = await (await handle(jobRequest({ url: 'example.com', previewMode: 'html' }), env)).json();
  delete env.QUOTAS;
  const events = await parse(await handle(new Request(`https://visualwayback.com/api/jobs/${id}/screenshots`), env));
  assert.equal(events.at(-1).type, 'error');
  const html = await parse(await handle(eventRequest(id), env));
  assert.equal(html.filter(e => e.type === 'capture' && e.capture.preview === 'iframe').length, 2);
});

test('later warm batches cannot replace the latest share screenshot with an older one', async t => {
  let now = Date.parse('2026-11-16T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const env = environment(); env.ENABLE_SCREENSHOT_CACHE = 'true'; env.RENDER_BATCH_SIZE = '1';
  const handle = createRuntime({ fetchArchive: indexFetch, launch: async () => ({ close: async () => {} }), render: async (_, capture) => ({ ...capture, text: 'Genuine cached text', png: new Uint8Array([1]) }) });
  const { id } = await (await handle(jobRequest(), env)).json();
  const request = new Request(`https://visualwayback.com/api/jobs/${id}/screenshots`);
  assert.equal((await parse(await handle(request, env))).at(-1).type, 'continue');
  now += 20000;
  assert.equal((await parse(await handle(request, env))).at(-1).type, 'done');
  assert.equal((await env.CACHE.get(`social:${id}`, 'json')).timestamp, captures[1].timestamp);
  assert.equal(env.CACHE.puts.filter(put => put.key === `social:${id}`).length, 1);
});

test('dense 24-capture jobs cache bounded index across sample sizes without monthly full scans', async () => {
  const env = environment(); env.PREVIEW_MODE = 'html';
  const calls = [];
  const handle = createRuntime({ fetchArchive: async (url, options) => {
    const p = new URL(url).searchParams; calls.push(p);
    assert.equal(options.redirect, 'manual'); assert.ok(options.signal);
    const stamps = p.get('collapse') ? Array.from({ length: 1200 }, () => '20000101000000') : [p.get('fastLatest') ? '20260101000000' : p.get('from')];
    return Response.json([['timestamp', 'original', 'digest'], ...stamps.map(s => [s, 'https://example.com/', s])]);
  } });
  const response = await handle(jobRequest({url:'example.com',count:24,previewMode:'html'}),env);
  assert.equal(response.status,202); const { id } = await response.json();
  const job = await env.CACHE.get(`job:${id}`, 'json');
  assert.equal(job.captures.length,24); assert.equal(job.index.timeSampled,true);
  assert.equal(job.captures[0].timestamp,'20000101000000'); assert.equal(job.captures.at(-1).timestamp,'20260101000000');
  assert.equal(calls.length,26); assert.ok(!calls.some(p=>p.get('collapse')==='timestamp:6'));
  const next = await handle(jobRequest({url:'example.com',count:16,previewMode:'html'}),env);
  assert.equal(next.status,202); assert.equal(calls.length,26,'Changing count reuses the independently cached index');
  assert.equal(env.CACHE.puts.filter(p=>p.key.startsWith('index:')).length,1);
});

test('index timeout has a useful error and never fabricates an empty timeline or caches failure', async () => {
  const env = environment();
  const handle = createRuntime({ fetchArchive: async () => {throw new DOMException('The operation was aborted due to timeout','TimeoutError');} });
  const response = await handle(jobRequest(),env);
  assert.equal(response.status,502); assert.match((await response.json()).error,/index is responding too slowly/);
  assert.equal(env.CACHE.puts.length,0);
});
async function save(env, capture) {
  const value = { ...capture, text: 'Archived text', image: `/cache/${key(capture)}.png`, renderVersion: RENDER_VERSION };
  await env.CACHE.put(`capture:${key(capture)}`, JSON.stringify(value), { expirationTtl: 604800 });
  await env.CACHE.put(`image:${key(capture)}`, new Uint8Array([1, 2]), { expirationTtl: 604800 });
}

test('quota reservations survive reset, serialize launches, and never refund failed launches', async () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  let state;
  for (let i = 0; i < LIMITS.browserBudgetMs / LIMITS.browserReservationMs; i++) {
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

test('batches reserve deadlines and writes atomically, shrink to budget, and refund only once', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const first = reserve(undefined, 'render', now, 8);
  assert.equal(first.body.captures, 8);
  assert.equal(first.state.browserMs, 265000);
  assert.equal(first.state.writes, 16);
  assert.equal(first.state.nextLaunch, now + 265000);
  const closed = release(first.state, first.body.token, now + 45000);
  assert.equal(closed.state.browserMs, 47000);
  assert.equal(release(closed.state, first.body.token, now + 46000).state, undefined);
  const low = { ...closed.state, browserMs: 430000, nextLaunch: now };
  assert.equal(reserve(low, 'render', now + 50000, 8).body.captures, 1);
  const fewWrites = { ...closed.state, writes: 396, nextLaunch: now };
  assert.equal(reserve(fewWrites, 'render', now + 50000, 8).body.captures, 2);
});

test('a batch reuses one browser, streams results immediately and survives a failed capture', async () => {
  const env = environment(); env.RENDER_BATCH_SIZE = '8';
  let launches = 0, closes = 0, renders = 0;
  const handle = createRuntime({ fetchArchive: indexFetch, launch: async () => { launches++; return { close: async () => { closes++; } }; }, render: async (_, capture) => {
    renders++;
    if (renders === 1) throw new Error('Archive reveal unavailable');
    return { ...capture, text: 'Working capture', png: new Uint8Array([1]) };
  } });
  const { id } = await (await handle(jobRequest(), env)).json();
  const events = await parse(await handle(eventRequest(id), env));
  assert.equal(launches, 1); assert.equal(closes, 1); assert.equal(renders, 2);
  const returned = events.filter(e => e.type === 'capture');
  assert.equal(returned.length, 2);
  assert.match(returned[0].capture.error, /reveal unavailable/);
  assert.equal(returned[1].capture.text, 'Working capture');
  assert.equal(events.at(-1).type, 'done');
  assert.ok(!events.some(e => e.type === 'continue'));
  const replay = await parse(await handle(eventRequest(id), env));
  assert.equal(replay.filter(e => e.type === 'capture' && e.cached).length, 2);
  assert.equal(launches, 1);
});

test('cached timeline verifies image existence without buffering PNG bodies', async () => {
  const env = environment();
  const handle = createRuntime({ fetchArchive: indexFetch, launch: async () => { throw new Error('Cached replay must not launch'); } });
  const { id } = await (await handle(jobRequest(), env)).json();
  for (const capture of captures) await save(env, capture);
  const originalGet = env.CACHE.get.bind(env.CACHE);
  let cancelled = 0;
  env.CACHE.get = async (key, type) => {
    if (!key.startsWith('image:')) return originalGet(key, type);
    assert.equal(type, 'stream');
    return new ReadableStream({ cancel() { cancelled++; } });
  };
  const events = await parse(await handle(eventRequest(id), env));
  assert.equal(cancelled, 2);
  assert.equal(events.filter(e => e.type === 'capture' && e.cached).length, 2);
  assert.equal(events.at(-1).type, 'done');
});

test('confirmed token refunds permit an eight-capture timeline, enforce 20s pacing, and are idempotent', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  let state;
  for (let i = 0; i < 8; i++) {
    const start = now + i * 31000;
    const reservation = reserve(state, 'render', start);
    assert.equal(reservation.status, 200);
    assert.equal(reservation.state.browserMs, i * 13000 + 90000);
    const closed = release(reservation.state, reservation.body.token, start + 10600);
    assert.equal(closed.state.browserMs, (i + 1) * 13000);
    assert.equal(reserve(closed.state, 'render', start + 30599).status, 429);
    assert.equal(release(closed.state, reservation.body.token, start + 11000).state, undefined);
    state = structuredClone(closed.state);
  }
  assert.equal(state.browserMs, 104000);
  assert.equal(state.launches, 8);
  assert.equal(release(state, '__proto__', now + 300000).status, 400);
  assert.equal(release(state, 'unknown', now + 300000).status, 400);
});

test('legacy running budget migrates without reset; expired or late tokens cannot release a newer lease', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const legacy = { day: '2026-11-15', launches: 5, writes: 10, jobs: 1, nextLaunch: now + 5000 };
  assert.equal(reserve(legacy, 'render', now).status, 429);
  const sixth = reserve(legacy, 'render', now + 5000);
  assert.equal(sixth.state.browserMs, 540000);
  assert.equal(reserve(sixth.state, 'render', now + 100000).status, 429);
  assert.equal(release(sixth.state, sixth.body.token, now + 86400000).status, 400);
  const first = reserve(undefined, 'render', now);
  const second = reserve(first.state, 'render', now + 90000);
  const late = release(second.state, first.body.token, now + 95000);
  assert.equal(late.state.nextLaunch, now + 180000);
  assert.equal(late.state.browserMs, 180000);
});

test('failed browser close retains full reservation and 90s continuation cooldown', async () => {
  const env = environment();
  const handle = createRuntime({ fetchArchive: indexFetch, launch: async () => ({ close: async () => { throw new Error('Close failed'); } }), render: async (_, capture) => ({ ...capture, text: 'Archived text', png: new Uint8Array([1]) }) });
  const { id } = await (await handle(jobRequest(), env)).json();
  const events = await parse(await handle(eventRequest(id), env));
  assert.equal(events.at(-1).type, 'continue');
  assert.equal(events.at(-1).retryAfter, 90);
  const retry = await parse(await handle(eventRequest(id), env));
  assert.equal(retry.at(-1).type, 'error');
  assert.ok(retry.at(-1).retryAfter > 20);
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
  assert.equal(events.at(-1).retryAfter, 20);
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

test('capture-local readiness failure is explicit, short-lived, and resume skips it to render the next capture', async t => {
  let now = Date.parse('2026-11-15T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const env = environment();
  const rendered = [];
  const handle = createRuntime({ fetchArchive: indexFetch, launch: async () => ({ close: async () => {} }), render: async (_, capture) => {
    rendered.push(capture.timestamp);
    if (capture.timestamp === captures[0].timestamp) throw new Error('Archive did not finish revealing (hidden headings: 1)');
    return { ...capture, text: 'Genuine archived content', png: new Uint8Array([1, 2, 3]) };
  } });
  const { id } = await (await handle(jobRequest(), env)).json();
  const first = await parse(await handle(eventRequest(id), env));
  assert.deepEqual(first.map(e => e.type), ['index', 'status', 'capture', 'continue']);
  const failure = first[2].capture;
  assert.match(failure.error, /hidden headings/);
  assert.equal(failure.requestedTimestamp, captures[0].timestamp);
  assert.equal(failure.archiveUrl, `https://web.archive.org/web/${captures[0].timestamp}/${captures[0].original}`);
  assert.equal(failure.image, undefined);
  assert.equal(failure.text, undefined);
  assert.equal(failure.failureExpiresAt, now + 3600000);
  const marker = env.CACHE.puts.find(put => put.key.startsWith('failure:'));
  assert.equal(marker.options.expirationTtl, 3600);
  assert.equal(env.CACHE.values.has(`capture:${key(captures[0])}`), false);
  assert.equal(env.CACHE.values.has(`image:${key(captures[0])}`), false);
  now += 20000;
  const second = await parse(await handle(eventRequest(id), env));
  assert.deepEqual(second.map(e => e.type), ['index', 'capture', 'status', 'capture', 'done']);
  assert.equal(second[1].cached, true);
  assert.equal(second[1].completed, 1);
  assert.equal(second[3].completed, 2);
  assert.ok(second[3].capture.image);
  assert.deepEqual(rendered, captures.map(c => c.timestamp));
  // Enforce expiry even if the provider has not yet removed an expired KV value.
  now += 3600000;
  await parse(await handle(eventRequest(id), env));
  assert.equal(rendered.at(-1), captures[0].timestamp);
  assert.equal(rendered.length, 3);
});

test('all unavailable captures finish as an explicit partial timeline and replay without browser work', async t => {
  let now = Date.parse('2026-11-15T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const env = environment();
  let launches = 0;
  const handle = createRuntime({ fetchArchive: indexFetch, launch: async () => { launches++; return { close: async () => {} }; }, render: async () => { throw new Error('Incomplete or unavailable archive replay'); } });
  const { id } = await (await handle(jobRequest(), env)).json();
  await parse(await handle(eventRequest(id), env));
  now += 20000;
  const final = await parse(await handle(eventRequest(id), env));
  assert.equal(final.at(-1).type, 'done');
  assert.equal(final.filter(e => e.type === 'capture' && e.capture.error).length, 2);
  env.ENABLE_RENDERING = 'false';
  const replay = await parse(await handle(eventRequest(id), env));
  assert.deepEqual(replay.map(e => e.type), ['index', 'capture', 'capture', 'done']);
  assert.equal(launches, 2);
});

test('launch failures and platform/archive throttles remain global errors without failure markers', async () => {
  for (const stage of ['launch', 'render']) {
    const env = environment();
    const handle = createRuntime({ fetchArchive: indexFetch, launch: async () => { if (stage === 'launch') throw new Error('Browser returned 429'); return { close: async () => {} }; }, render: async () => { throw new Error('Archive returned HTTP 503'); } });
    const { id } = await (await handle(jobRequest(), env)).json();
    const events = await parse(await handle(eventRequest(id), env));
    assert.equal(events.at(-1).type, 'error');
    assert.equal(events.at(-1).retryAfter, 90);
    assert.equal(env.CACHE.puts.length, 1);
    assert.equal(events.some(e => e.type === 'capture'), false);
  }
});

test('incidental status-code digits inside an asset URL do not stop the entire cache batch', async () => {
  const env = environment(); env.RENDER_BATCH_SIZE = '8';
  let attempts = 0;
  const handle = createRuntime({ fetchArchive: indexFetch, launch: async () => ({ close: async () => {} }), render: async (_, capture) => {
    if (++attempts === 1) throw new Error('Asset unavailable: https://example.com/analytics?cid=1503123429');
    return { ...capture, text: 'Usable archive text', png: new Uint8Array([1]) };
  } });
  const { id } = await (await handle(jobRequest(), env)).json();
  const events = await parse(await handle(eventRequest(id), env));
  assert.equal(attempts, 2);
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.filter(e => e.type === 'capture').length, 2);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../cloudflare/runtime.js';
import { HTML_VERSION, MAX_HTML, normalizeHtmlText, archiveHtmlAllowed } from '../cloudflare/html.js';
import { keyFor, RENDER_VERSION } from '../lib.js';
import { groupCaptures, comparableText } from '../group.js';

const captures = Array.from({ length: 16 }, (_, i) => ({ timestamp: `${2000 + i}0101000000`, original: 'https://example.com/', digest: String(i) }));
const key = c => keyFor(c.timestamp + c.original + ':' + RENDER_VERSION);
function environment() {
  const values = new Map(), calls = [], puts = [];
  return { PREVIEW_MODE: 'html', ENABLE_RENDERING: 'false', calls, puts, values,
    CACHE: { async get(k, type) { const v = values.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; }, async put(k, v, options) { values.set(k, v); puts.push({ key: k, options }); } },
    QUOTAS: { idFromName: n => n, get: () => ({ fetch: async url => { calls.push(new URL(url).pathname); return Response.json({ ok: true }); } }) },
  };
}
const request = (count = 8) => new Request('https://visualwayback.com/api/jobs', { method: 'POST', body: JSON.stringify({ url: 'example.com', count, previewMode: 'html' }) });
const events = (id, signal) => new Request(`https://visualwayback.com/api/jobs/${id}/events`, { signal });
const parse = async response => (await response.text()).split('\n\n').filter(Boolean).map(line => JSON.parse(line.slice(6)));
const source = () => new Response('<html><title>Archived</title><body>A sufficiently long archived page with meaningful comparable text.</body></html>', { headers: { 'Content-Type': 'text/html' } });
// Fixture-only parser injection. Production uses native HTMLRewriter, not regex.
const parser = async () => ({ title: 'Archived', text: 'A sufficiently long archived page with meaningful comparable text.', comparisonUnavailable: false });
function runtime(fetchPage = async () => source(), extractHtml = parser) {
  return createRuntime({ launch: () => { throw new Error('HTML previews must never launch browsers'); }, render: () => { throw new Error('No screenshots'); }, extractHtml, fetchArchive: async (url, options) => url.includes('/cdx/') ? Response.json([['timestamp', 'original', 'digest'], ...captures.map(c => [c.timestamp, c.original, c.digest])]) : fetchPage(url, options) });
}

test('HTML normalization preserves word boundaries, decodes entities and removes duplicate responsive lines', () => {
  assert.equal(normalizeHtmlText('Hello &amp; goodbye\nHello &amp; goodbye\nPrice &#36;10\n&#x1f600;').text, 'Hello & goodbye\nPrice $10\n😀');
  assert.equal(normalizeHtmlText('x'.repeat(13000)).textTruncated, true);
  assert.equal(normalizeHtmlText('x'.repeat(13000)).text.length, 12000);
  assert.equal(archiveHtmlAllowed('https://web.archive.org/web/20260101000000if_/https://example.com/'), true);
  for (const url of ['http://web.archive.org/web/20260101000000/https://example.com/', 'https://web.archive.org:444/web/20260101000000/https://example.com/', 'https://user@web.archive.org/web/20260101000000/https://example.com/', 'https://localhost/', 'https://web.archive.org/save/https://example.com/']) assert.equal(archiveHtmlAllowed(url), false);
});

test('outdated screenshot-only clients receive a reload instruction instead of broken image cards', async () => {
  const env = environment(), handle = runtime();
  const response = await handle(new Request('https://visualwayback.com/api/jobs', { method: 'POST', body: JSON.stringify({ url: 'example.com' }) }), env);
  assert.equal(response.status, 409); assert.match((await response.json()).error, /Reload/);
  assert.equal(env.calls.length, 0);
});

test('HTML previews stream before extraction, without a browser or rendering quota', async () => {
  const env = environment(); let release;
  const ready = new Promise(resolve => { release = resolve; });
  const handle = runtime(async () => { await ready; return source(); });
  const { id } = await (await handle(request(), env)).json();
  const response = await handle(events(id), env), reader = response.body.getReader();
  const index = JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6));
  assert.equal(index.previewMode, 'html');
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6));
  assert.equal(first.capture.textPending, true);
  assert.match(first.capture.previewUrl, /^https:\/\/web.archive.org\/web\/\d{14}if_\//);
  release();
  let rest = '';
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value); }
  assert.match(rest, /"textSource":"html"/);
  assert.ok(!env.calls.includes('/render'));
  assert.ok(env.puts.filter(p => p.key.startsWith('html:')).length === 8);
  assert.ok(!env.puts.some(p => p.key.startsWith('image:')));
});

test('HTML metadata is cached separately and replays without extraction or quota writes', async () => {
  const env = environment(); let fetches = 0;
  const handle = runtime(async () => { fetches++; return source(); });
  const { id } = await (await handle(request(), env)).json();
  const first = await parse(await handle(events(id), env));
  assert.equal(first.at(-1).type, 'done');
  assert.equal(fetches, 8);
  assert.ok(first.filter(e => e.capture?.htmlVersion === HTML_VERSION).every(e => e.capture.textSource === 'html'));
  const writes = env.puts.length, quotas = env.calls.filter(path => path !== '/site').length;
  const second = await parse(await handle(events(id), env));
  assert.equal(second.filter(e => e.type === 'capture').length, 8);
  assert.equal(fetches, 8); assert.equal(env.puts.length, writes); assert.equal(env.calls.filter(path => path !== '/site').length, quotas);
});

test('cached genuine PNGs stay available and failed screenshot markers never block iframe previews', async () => {
  const env = environment(), capture = captures[0];
  env.values.set(`capture:${key(capture)}`, JSON.stringify({ ...capture, text: 'Existing rendered text', title: 'Existing title', image: `/cache/${key(capture)}.png`, renderVersion: RENDER_VERSION }));
  env.values.set(`image:${key(capture)}`, new Uint8Array([1]));
  for (const c of captures) env.values.set(`failure:${key(c)}`, JSON.stringify({ ...c, error: 'Old screenshot reveal failed', renderVersion: RENDER_VERSION, failureExpiresAt: Date.now() + 60000 }));
  const handle = runtime(); const { id } = await (await handle(request(), env)).json();
  const returned = await parse(await handle(events(id), env));
  const png = returned.filter(e => e.capture?.requestedTimestamp === capture.timestamp);
  assert.ok(png.length >= 2 && png.every(e => e.capture.image));
  assert.ok(returned.some(e => e.capture?.preview === 'iframe' && !e.capture.error));
  assert.ok(!returned.some(e => e.capture?.error));
});

test('fully photographed timelines retain instant rendered-text comparisons without HTML requests', async () => {
  const env = environment(); let fetched = 0;
  const handle = runtime(async () => { fetched++; return source(); });
  for (const c of captures) {
    env.values.set(`capture:${key(c)}`, JSON.stringify({ ...c, text: 'The text from this genuine cached screenshot.', image: `/cache/${key(c)}.png`, renderVersion: RENDER_VERSION }));
    env.values.set(`image:${key(c)}`, new Uint8Array([1]));
  }
  const { id } = await (await handle(request(), env)).json();
  const quotas = env.calls.filter(path => path !== '/site').length;
  const returned = await parse(await handle(events(id), env));
  assert.equal(fetched, 0); assert.equal(env.calls.filter(path => path !== '/site').length, quotas);
  assert.equal(returned.at(-1).type, 'done');
  assert.ok(returned.some(e => e.type === 'index' && e.previewMode === 'cached'));
  assert.ok(returned.filter(e => e.type === 'capture' && !e.capture.textPending).every(e => e.capture.textSource === 'rendered' && e.capture.image));
});

test('live/local/credentialed replay redirects are rejected; iframe remains usable without comparison', async () => {
  for (const target of ['https://example.com/private', 'http://127.0.0.1/', 'https://name@web.archive.org/web/20200101000000/https://example.com/']) {
    const env = environment(); let fetched = [];
    const handle = runtime(async (url, options) => { fetched.push(url); assert.equal(options.redirect, 'manual'); return new Response(null, { status: 302, headers: { location: target } }); });
    const { id } = await (await handle(request(), env)).json();
    const returned = await parse(await handle(events(id), env));
    assert.ok(fetched.every(url => new URL(url).hostname === 'web.archive.org'));
    assert.ok(returned.some(e => e.capture?.comparisonUnavailable && !e.capture.textPending && e.capture.preview === 'iframe'));
    assert.ok(!returned.some(e => e.capture?.error));
    assert.equal(returned.at(-1).type, 'done');
  }
});

test('bounded HTML failures preserve previews and throttling is explicit instead of fabricated text', async () => {
  for (const fetchPage of [async () => new Response('x'.repeat(MAX_HTML + 1), { headers: { 'Content-Type': 'text/html' } }), async () => new Response('binary', { headers: { 'Content-Type': 'application/pdf' } })]) {
    const env = environment(), handle = runtime(fetchPage); const { id } = await (await handle(request(), env)).json();
    const returned = await parse(await handle(events(id), env));
    assert.ok(returned.some(e => e.capture?.textError));
    assert.ok(!returned.some(e => e.capture?.error));
  }
  const env = environment(), handle = runtime(async () => new Response('Throttled', { status: 429 }));
  const { id } = await (await handle(request(), env)).json();
  const returned = await parse(await handle(events(id), env));
  assert.equal(returned.filter(e => e.type === 'capture').length, 8);
  assert.equal(returned.at(-1).type, 'error');
  assert.match(returned.at(-1).message, /throttling/);
  assert.ok(!env.puts.some(p => p.key.startsWith('html:')));
});

test('HTML batches are bounded to eight and resume without artificial browser cooldowns', async () => {
  const env = environment(); let fetches = 0;
  const handle = runtime(async () => { fetches++; return source(); });
  const { id } = await (await handle(request(16), env)).json();
  const first = await parse(await handle(events(id), env));
  assert.equal(fetches, 8);
  assert.deepEqual(first.at(-1), { type: 'continue', source: 'html', retryAfter: 1 });
  const second = await parse(await handle(events(id), env));
  assert.equal(fetches, 16); assert.equal(second.at(-1).type, 'done');
});

test('cache quota exhaustion keeps all direct previews and does not contact upstream HTML', async () => {
  const env = environment(); let fetches = 0;
  env.QUOTAS.get = () => ({ fetch: async url => new URL(url).pathname === '/write' ? Response.json({ ok: false, error: 'Daily cache write allowance exhausted.', retryAfter: 3600 }, { status: 429 }) : Response.json({ ok: true }) });
  const handle = runtime(async () => { fetches++; return source(); });
  const { id } = await (await handle(request(), env)).json();
  const returned = await parse(await handle(events(id), env));
  assert.equal(returned.filter(e => e.capture?.preview === 'iframe').length, 8);
  assert.equal(returned.at(-1).type, 'error');
  assert.match(returned.at(-1).message, /cache write/); assert.equal(fetches, 0);
});

test('disconnect aborts in-flight archive HTML and never writes late metadata', async () => {
  const env = environment(), abort = new AbortController();
  let began;
  const started = new Promise(resolve => { began = resolve; });
  const handle = runtime(async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }); began();
  }));
  const { id } = await (await handle(request(), env)).json();
  const response = await handle(events(id, abort.signal), env);
  const finished = response.text(); await started; abort.abort(); await finished;
  assert.ok(!env.puts.some(p => p.key.startsWith('html:')));
});

test('missing/truncated/pending text and mixed sources are never silently grouped or compared', () => {
  const base = { timestamp: '20200101000000', original: 'https://example.com/', text: 'An identical body of meaningful text.', textSource: 'html' };
  const same = { ...base, timestamp: '20210101000000' };
  assert.equal(groupCaptures([base, same]).length, 1);
  for (const flags of [{ text: '', comparisonUnavailable: true }, { textTruncated: true }, { textPending: true }, { textSource: 'rendered' }]) {
    assert.equal(comparableText(base, { ...same, ...flags }), false);
    assert.equal(groupCaptures([base, { ...same, ...flags }]).length, 2);
  }
});

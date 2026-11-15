import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blogSitemapEntries, blogScriptHashes, handleBlogRequest } from '../blog.js';
import { archiveRequestAllowed, waitForCaptureReady } from '../renderer.js';

test('static build contains real offline demos, indexed blog HTML, support assets and security headers', async () => {
  await import('../tools/build-cloudflare.js');
  const root = new URL('../.cache/cloudflare-assets/', import.meta.url);
  for (const [name, count] of [['stripe', 4], ['amazon', 6]]) {
    const manifest = JSON.parse(await readFile(new URL(`api/demos/${name}`, root), 'utf8'));
    assert.equal(manifest.captures.length, count);
    for (const capture of manifest.captures) {
      const png = await readFile(new URL(capture.image.slice(1), root));
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
    }
  }
  for (const { path } of blogSitemapEntries) assert.equal(await readFile(new URL(`${path.slice(1)}index.html`, root), 'utf8'), handleBlogRequest(path).body);
  const headers = await readFile(new URL('_headers', root), 'utf8');
  for (const hash of blogScriptHashes) assert.ok(headers.includes(hash));
  assert.ok(headers.includes('https://challenges.cloudflare.com'));
  const policies = headers.split('\n').filter(line => line.trim().startsWith('Content-Security-Policy:'));
  assert.equal(policies.length, 2);
  for (const policy of policies) assert.ok(policy.includes("connect-src 'self' https://challenges.cloudflare.com;"));
  assert.ok(!headers.includes('unsafe-inline'));
  assert.ok((await readFile(new URL('robots.txt', root), 'utf8')).includes('visualwayback.com/sitemap.xml'));
});

test('generated browser adapter shares exact readiness and archive-only HTTP/WebSocket isolation', async () => {
  await import('../tools/build-cloudflare.js');
  const generated = await import('../.cache/cloudflare-runtime/renderer.js');
  assert.equal(generated.waitForCaptureReady.toString(), waitForCaptureReady.toString());
  assert.equal(generated.archiveRequestAllowed.toString(), archiveRequestAllowed.toString());
  for (const url of ['http://web.archive.org/a', 'https://example.com', 'https://127.0.0.1', 'https://web.archive.org:444/a', 'wss://web.archive.org/a']) assert.equal(generated.archiveRequestAllowed(url), false);
  const handlers = {};
  const context = { route: async (pattern, handler) => { assert.equal(pattern, '**/*'); handlers.http = handler; }, routeWebSocket: async (pattern, handler) => { assert.equal(pattern, '**/*'); handlers.ws = handler; }, on: () => {} };
  await generated.isolatedContext({ newContext: async options => { assert.equal(options.serviceWorkers, 'block'); assert.equal(options.acceptDownloads, false); return context; } });
  let allowed = 0, blocked = 0, socketsClosed = 0;
  for (const url of ['https://web.archive.org/web/20000101000000/http://example.com', 'https://example.com/fallback', 'http://localhost/']) await handlers.http({ request: () => ({ url: () => url }), continue: () => { allowed++; }, abort: () => { blocked++; } });
  handlers.ws({ close: () => { socketsClosed++; } });
  assert.deepEqual([allowed, blocked, socketsClosed], [1, 2, 1]);
  await assert.rejects(() => generated.isolatedContext({ newContext: async () => ({ ...context, routeWebSocket: undefined }) }), /routeWebSocket/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { hasUnterminatedScript } from '../cloudflare/html.js';

test('native HTMLRewriter identifies the real truncated AMD capture without rejecting sparse or JavaScript pages', async t => {
  const source = await readFile(new URL('../cloudflare/html.js', import.meta.url), 'utf8');
  const worker = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-11-15', modules: [
    { type: 'ESModule', path: 'worker.js', contents: 'import { extractHtml } from "./html.js"; export default { async fetch(request) { return Response.json(await extractHtml(await request.text())); } };' },
    { type: 'ESModule', path: 'html.js', contents: source },
  ] }));
  t.after(() => worker.dispose());
  const extract = async html => (await worker.dispatchFetch('https://fixture.invalid/', { method: 'POST', body: html })).json();
  const amd = await readFile(new URL('./fixtures/amd-20080828141224.html', import.meta.url), 'utf8');
  assert.equal(hasUnterminatedScript(amd), true);
  const broken = await extract(amd);
  assert.equal(broken.text, '');
  assert.equal(broken.replayUnavailable, true);
  // Include the Archive's injected scripts and appended comment, as in the live replay.
  assert.equal((await extract(amd.replace('<head>', '<head><script>window.__wm = {};</script>') + '<!-- FILE ARCHIVED ON 14:12:24 Aug 28, 2008 -->')).replayUnavailable, true);
  for (const html of [
    '<html><body><img src="hero.gif"></body></html>',
    '<html><body><svg><rect width="100" height="100"/></svg></body></html>',
    '<html><body><div id="root"></div><script src="app.js"></script></body></html>',
    '<html><head><script>document.write("hello")</script></head></html>',
    '<html><body><h1>Saved page</h1><script>truncated(',
    '<html><body><img src="hero.gif"><script>truncated(',
    '<html><body><svg><rect width="100" height="100"/></svg><script>truncated(',
    '<html><body>Short page</body></html>',
    '<!-- <script>not a real script --> <body>Readable page</body>',
  ]) assert.notEqual((await extract(html)).replayUnavailable, true, html);
});

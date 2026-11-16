// Deterministic UI/security fixtures only. Real archive checks run in a muted Space.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser, page;
const deadline = setTimeout(() => { server.kill('SIGTERM'); process.exitCode = 1; }, 90000);
try {
  const [output] = await once(server.stdout, 'data');
  const base = String(output).match(/http:\/\/localhost:\d+/)[0];
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => console.error('Fixture page error:', error.message));
  await page.addInitScript(() => {
    window.testStreams = [];
    window.EventSource = class { constructor() { window.testStreams.push(this); } close() { this.closed = true; } };
    window.emit = event => window.testStreams.at(-1).onmessage({ data: JSON.stringify(event) });
  });
  await page.route('**/api/jobs', route => route.fulfill({ json: { id: 'a'.repeat(24), url: 'https://fixture.invalid/' } }));
  let popups = 0, liveRequests = 0;
  page.on('popup', popup => { popups++; void popup.close(); });
  await page.route('https://web.archive.org/**', route => {
    liveRequests++;
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Archive fixture</title><body style="margin:0;background:#dce5ef"><h1>Deterministic archive fixture</h1><script>try{top.document.body.dataset.archiveEscaped="yes"}catch{document.body.dataset.parentAccess="blocked"}try{window.open("https://evil.invalid/")}catch{}</script></body>' });
  });
  await page.goto(base + '/?url=fixture.invalid');
  await page.waitForFunction(() => window.testStreams.length === 1);
  const captures = Array.from({ length: 6 }, (_, i) => ({ timestamp: `${2000 + i}0101000000`, requestedTimestamp: `${2000 + i}0101000000`, original: 'https://fixture.invalid/', archiveUrl: `https://web.archive.org/web/${2000 + i}0101000000/https://fixture.invalid/`, previewUrl: `https://web.archive.org/web/${2000 + i}0101000000if_/https://fixture.invalid/`, preview: 'iframe', text: '', textSource: 'html', textPending: true, comparisonUnavailable: true }));
  await page.evaluate(captures => {
    window.emit({ type: 'index', total: 6, sampled: 6, captures, textSource: 'html', previewMode: 'html' });
    for (const capture of captures) window.emit({ type: 'capture', capture });
  }, captures);
  await page.waitForFunction(() => document.querySelectorAll('.live-frame[src]').length > 0);
  assert.ok(await page.locator('.live-frame[src]').count() <= 8);
  assert.match(await page.locator('#stats').innerText(), /6 not compared/);
  const firstFrame = page.locator('.live-frame').first();
  assert.equal(await firstFrame.getAttribute('sandbox'), 'allow-scripts allow-same-origin');
  assert.equal(await firstFrame.getAttribute('referrerpolicy'), 'no-referrer');
  assert.match(await firstFrame.getAttribute('allow'), /autoplay 'none'/);
  const child = await (await firstFrame.elementHandle()).contentFrame();
  await child.waitForFunction(() => document.body.dataset.parentAccess === 'blocked');
  assert.equal(await page.locator('body').getAttribute('data-archive-escaped'), null);
  assert.equal(popups, 0);
  await firstFrame.evaluate(frame => { window.originalFrame = frame; });
  const ready = captures.map((capture, i) => ({ ...capture, textPending: false, comparisonUnavailable: i >= 4, text: i >= 4 ? '' : i < 2 ? 'The same meaningful archived text for adjacent capture grouping.' : `A different unique archived statement from year ${2000 + i} changes entirely.`, title: 'Updated HTML title', textError: i >= 4 ? 'JavaScript-only content is not available in HTML.' : undefined }));
  await page.evaluate(ready => { for (const capture of ready) window.emit({ type: 'capture', capture }); }, ready);
  assert.equal(await firstFrame.evaluate(frame => frame === window.originalFrame), true, 'title/text updates must not reload active frames');
  await page.evaluate(() => window.emit({ type: 'done' }));
  assert.equal(await page.locator('.timeline-entry').count(), 5, 'unknown text must remain separate');
  assert.equal(await page.locator('.text-status').count(), 2);
  await page.locator('#all-view').click();
  assert.ok(await page.locator('.live-frame').count() <= 8);
  await page.locator('.timeline-entry').nth(1).scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.timeline-entry')][1].querySelector('.live-frame').hasAttribute('src'));
  await page.locator('.timeline-entry').last().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.timeline-entry')].at(-1).querySelector('.live-frame[src]'));
  assert.ok(await page.locator('.live-frame[src]').count() <= 8);
  await mkdir('artifacts/html-previews', { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('.timeline-entry').first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.body.scrollWidth <= innerWidth);
    const rect = await page.locator('.live-stage').first().boundingBox();
    assert.ok(Math.abs(rect.height / rect.width - 800 / 1280) < .01);
    await page.screenshot({ path: `artifacts/html-previews/${width}.png`, fullPage: true });
  }
  const before = liveRequests;
  await page.locator('#url').fill('fixture.invalid/invalid');
  await page.locator('#search-form').evaluate(form => form.requestSubmit());
  await page.waitForFunction(() => window.testStreams.length === 2);
  await page.evaluate(capture => {
    const invalid = { ...capture, timestamp: '20100101000000', requestedTimestamp: '20100101000000', previewUrl: 'https://evil.invalid/' };
    window.emit({ type: 'index', total: 1, sampled: 1, captures: [invalid], textSource: 'html' });
    window.emit({ type: 'capture', capture: invalid }); window.emit({ type: 'done' });
  }, ready[0]);
  assert.match(await page.locator('.live-status').last().innerText(), /Invalid archive/);
  assert.ok(liveRequests >= before);
  assert.ok(!await page.locator('iframe[src^="https://evil.invalid"]').count());
  // A new search must tear down old iframe documents, not leave them in the background.
  await page.locator('#url').fill('stripe.com');
  await page.locator('#search-form').evaluate(form => form.requestSubmit());
  await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
  assert.equal(await page.locator('.live-frame').count(), 0);
  // Fixture posters only. Real capture evidence is checked separately.
  await page.route('**/api/jobs', route => route.fulfill({ json: { id: 'b'.repeat(24), url: 'https://fixture.invalid/', screenshotCache: true } }));
  await page.route('**/cache/*.png', route => route.fulfill({ path: 'public/icon-512.png', contentType: 'image/png' }));
  const previousStreams = await page.evaluate(() => window.testStreams.length);
  await page.locator('#url').fill('fixture.invalid');
  await page.locator('#search-form').evaluate(form => form.requestSubmit());
  await page.waitForFunction(n => window.testStreams.length > n, previousStreams);
  await page.evaluate(ready => {
    window.emit({ type: 'index', total: 2, sampled: 2, captures: ready.slice(0, 2), textSource: 'html' });
    for (const capture of ready.slice(0, 2)) window.emit({ type: 'capture', capture });
    window.emit({ type: 'done' });
  }, ready);
  await page.waitForFunction(n => window.testStreams.length === n + 2, previousStreams);
  await page.evaluate(capture => window.emit({ type: 'capture', capture: { ...capture, text: 'Different rendered text must not replace HTML.', textSource: 'rendered', image: '/cache/' + 'c'.repeat(24) + '.png' } }), ready[0]);
  await page.locator('#changes-view').click();
  assert.equal(await page.locator('.timeline-entry').count(), 1, 'Screenshot arrivals preserve HTML grouping');
  assert.ok(await page.locator('img[src^="/cache/"]').count());
  await page.evaluate(() => window.emit({ type: 'error', message: 'Free quota exhausted', retryAfter: 86400 }));
  assert.equal(await page.locator('#error').isVisible(), false, 'Cache limits must not mark a working timeline as failed');
  await page.locator('#url').fill('stripe.com');
  await page.locator('#search-form').evaluate(form => form.requestSubmit());
  await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
  assert.equal(await page.evaluate(() => window.testStreams.at(-1).closed), true);
  console.log('PASS: HTML-first cards, no false grouping, stable iframe nodes, retained resident cache, search cleanup, sandbox isolation, safe URLs, responsive desktop-scale previews and PNG presets. Fixture HTML only. Long traversal/budget checks: preview-scheduler.test.js.');
} catch (error) {
  console.log(await page?.evaluate(() => [...document.querySelectorAll('.live-preview')].map(n => ({ disposed: n.dataset.previewDisposed, src: n.querySelector('iframe')?.getAttribute('src'), status: n.innerText, top: n.getBoundingClientRect().top, bottom: n.getBoundingClientRect().bottom }))));
  throw error;
} finally {
  clearTimeout(deadline); await browser?.close(); server.kill('SIGTERM');
  if (server.exitCode == null) await once(server, 'exit');
}

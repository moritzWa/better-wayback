// Run via heavy-job.py --wait. Own bounded preview process; no live account needed.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '0', SUPPORT_EMAIL: '', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser;
const deadline = setTimeout(() => { child.kill('SIGTERM'); process.exitCode = 1; }, 60000);
try {
  const [chunk] = await once(child.stdout, 'data');
  const base = String(chunk).match(/http:\/\/localhost:\d+/)[0];
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const screenshots = new URL('../artifacts/support/', import.meta.url).pathname;
  await mkdir(screenshots, { recursive: true });
  for (const path of ['/', '/blog/']) {
    let challengeLoads = 0;
    await page.route('https://challenges.cloudflare.com/**', async route => {
      challengeLoads++;
      await route.fulfill({ contentType: 'text/javascript', body: `window.turnstile={render(node,opts){window.testSupportOptions=opts;return 'test-widget'},remove(){}};` });
    });
    await page.goto(base + path);
    const csp = await page.evaluate(async () => (await fetch(location.href)).headers.get('content-security-policy'));
    assert.ok(csp.includes('https://challenges.cloudflare.com'));
    assert.ok(!csp.includes('unsafe-inline'));
    assert.equal(challengeLoads, 0);
    assert.equal(await page.locator('[data-support-panel]').isVisible(), false);
    await page.locator('[data-support-open]').click();
    await page.getByRole('status').filter({ hasText: 'not configured' }).waitFor();
    assert.equal(challengeLoads, 0);
    await page.locator('[data-support-cancel]').click();
    await page.route('**/api/support/config', route => route.fulfill({ json: { siteKey: 'test-public-key' } }));
    await page.route('**/api/support/reveal', route => route.fulfill({ json: { mailto: 'mailto:support@example.invalid' } }));
    await page.locator('[data-support-open]').click();
    await page.getByRole('status').filter({ hasText: 'Complete the check' }).waitFor();
    assert.equal(await page.locator('a[href^="mailto:"]').count(), 0);
    await page.evaluate(() => window.testSupportOptions['expired-callback']());
    await page.getByRole('status').filter({ hasText: 'expired' }).waitFor();
    await page.locator('[data-support-open]').click();
    await page.getByRole('status').filter({ hasText: 'Complete the check' }).waitFor();
    await page.evaluate(() => window.testSupportOptions.callback('test-token'));
    await page.getByRole('link', { name: 'support@example.invalid' }).waitFor();
    await page.screenshot({ path: screenshots + (path === '/' ? 'homepage.png' : 'blog.png'), fullPage: true });
    await page.locator('[data-support-cancel]').click();
    assert.equal(await page.locator('[data-support-panel]').isVisible(), false);
    assert.equal(await page.locator('a[href^="mailto:"]').count(), 0);
    await page.unroute('**/api/support/config');
    await page.unroute('**/api/support/reveal');
    await page.unroute('https://challenges.cloudflare.com/**');
  }
  const sse = await browser.newPage();
  await sse.clock.install();
  await sse.addInitScript(() => {
    window.connections = [];
    window.EventSource = class {
      constructor(url) { this.url = url; window.connections.push(this); }
      close() { this.closed = true; }
    };
    window.emit = event => window.connections.at(-1).onmessage({ data: JSON.stringify(event) });
  });
  await sse.route('**/api/jobs', route => route.fulfill({ json: { id: 'a'.repeat(24), url: 'https://fixture.invalid/' } }));
  await sse.route('**/cache/fixture.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"/>' }));
  await sse.goto(base + '/?url=fixture.invalid');
  await sse.waitForFunction(() => window.connections.length === 1);
  const capture = year => ({ timestamp: `${year}0101000000`, original: 'https://fixture.invalid/', title: 'Fixture', text: `Page ${year}`, image: '/cache/fixture.svg', archiveUrl: 'https://example.invalid/' });
  const index = { type: 'index', total: 2, sampled: 2, captures: [capture(2000), capture(2010)] };
  await sse.evaluate(({ index, first }) => { window.emit(index); window.emit({ type: 'capture', capture: first }); window.emit({ type: 'continue', retryAfter: 90 }); }, { index, first: capture(2000) });
  assert.equal(await sse.locator('.entry-pending').count(), 1);
  await sse.clock.fastForward(89000);
  assert.equal(await sse.evaluate(() => window.connections.length), 1);
  await sse.clock.fastForward(1000);
  assert.equal(await sse.evaluate(() => window.connections.length), 2);
  await sse.evaluate(({ index, first, second }) => { window.emit(index); window.emit({ type: 'capture', capture: first }); window.emit({ type: 'capture', capture: second }); window.emit({ type: 'done' }); }, { index, first: capture(2000), second: capture(2010) });
  assert.match(await sse.locator('#stats').innerText(), /2\/2 sampled/);
  assert.equal(await sse.locator('.timeline-entry').count(), 2);
  // Quota errors keep the first preview and visibly label the unfinished capture.
  await sse.locator('#search-form').evaluate(form => form.requestSubmit());
  await sse.waitForFunction(() => window.connections.length === 3);
  await sse.evaluate(({ index, first }) => { window.emit(index); window.emit({ type: 'capture', capture: first }); window.emit({ type: 'error', message: 'Daily free quota reached.', retryAfter: 600 }); }, { index, first: capture(2000) });
  assert.equal(await sse.locator('.timeline-entry img').count(), 1);
  assert.equal(await sse.locator('.entry-error').count(), 1);
  assert.match(await sse.locator('#error').innerText(), /10 minutes/);
  await sse.clock.fastForward(3600000);
  assert.equal(await sse.evaluate(() => window.connections.length), 3);
  await sse.close();
  console.log('Support UI passed: lazy load, missing config, expiry, reveal, cancel; screenshots in artifacts/support/.');
  console.log('Multi-connection SSE passed: 90-second delay, replay deduplication, completion and quota partial results.');
} finally {
  clearTimeout(deadline);
  await browser?.close();
  child.kill('SIGTERM');
  await once(child, 'exit');
}

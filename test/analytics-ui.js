// Headless tracking integration, not an archive-rendering fidelity test.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    if (window !== window.top) return;
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    sessionStorage.setItem('usage-session', '00000000-0000-4000-8000-000000000000');
  });
  const received = [], errors = [];
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'https://visualwayback.com') return route.abort();
    if (url.pathname === '/api/analytics') {
      received.push(request.postDataJSON());
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === '/api/jobs') return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Daily new timeline allowance exhausted.' }) });
    const path = resolve('.cache/cloudflare-assets', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    try {
      const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
      await route.fulfill({ status: 200, contentType: types[extname(path)] || 'application/json', body: await readFile(path) });
    } catch { await route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://visualwayback.com/');
  await page.waitForFunction(() => !document.getElementById('search-button').disabled && document.querySelectorAll('.entry-card').length > 0);
  await assertEventually(() => received.some(e => e.event === 'timeline_ready'));
  assert.equal(received.find(e => e.event === 'timeline_ready').source, 'automatic');
  assert.equal(received.find(e => e.event === 'timeline_ready').mode, 'demo');
  await page.locator('[data-site="amazon.com"]').click();
  await assertEventually(() => received.some(e => e.event === 'timeline_ready' && e.source === 'user'));
  await page.locator('#timeline .preview-interact-button').first().click();
  await assertEventually(() => received.some(e => e.event === 'preview_opened'));
  await page.locator('#url').fill('example.org');
  await page.locator('#search-button').click();
  await assertEventually(() => received.some(e => e.event === 'quota_reached'));
  assert.equal(received.filter(e => e.event === 'search_failed').length, 0);
  assert.equal(received.filter(e => e.event === 'timeline_ready' && e.mode === 'custom').length, 0);
  assert.deepEqual(errors, []);
  assert.ok(received.every(e => !('url' in e) && !('ip' in e)));
  const before = received.length;
  await page.goto('https://visualwayback.com/?analytics=off');
  await page.waitForFunction(() => !document.getElementById('search-button').disabled && document.querySelectorAll('.entry-card').length > 0);
  assert.equal(received.length, before);
  await context.route('**/analytics.js', route => route.abort());
  await page.goto('https://visualwayback.com/');
  await page.waitForFunction(() => !document.getElementById('search-button').disabled && document.querySelectorAll('.entry-card').length > 0);
  assert.equal(received.length, before);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, events: received.map(e => ({ event: e.event, source: e.source, mode: e.mode })), optOut: 'no requests', blockedModule: 'app still works', pageErrors: errors }));
} finally { await browser.close(); }

async function assertEventually(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(check(), 'Expected analytics event');
}

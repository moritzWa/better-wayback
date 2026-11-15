// Explicit UI fixtures only. Real archive/demo integration is checked separately.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { handleBlogRequest } from '../blog.js';

await mkdir('test-output', { recursive: true });
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const blog = handleBlogRequest(path);
  if (blog) { res.writeHead(blog.status, { 'Content-Type': blog.contentType }); res.end(blog.body); return; }
  const files = { '/': ['public/index.html', 'text/html'], '/app.js': ['public/app.js', 'text/javascript'], '/style.css': ['public/style.css', 'text/css'], '/group.js': ['group.js', 'text/javascript'] };
  if (!files[path]) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': files[path][1] }); res.end(await readFile(files[path][0]));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  let jobRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/jobs')) jobRequests++; });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.fixtureStreamCount = 0;
    window.EventSource = class { constructor() { window.fixtureStream = this; window.fixtureStreamCount++; } close() {} };
    window.emitFixture = event => window.fixtureStream.onmessage({ data: JSON.stringify(event) });
  });
  const capture = (year, text = 'Original fixture page', title = 'UI fixture') => ({ timestamp: `${year}0101000000`, original: 'https://fixture.test/', text, title, archiveUrl: `https://web.archive.org/web/${year}0101000000/https://fixture.test/`, image: '/cache/ui-fixture.svg' });
  const selected = [2000, 2001, 2005, 2010].map(year => ({ timestamp: `${year}0101000000`, original: 'https://fixture.test/' }));
  let releaseDemo;
  const demoGate = new Promise(resolve => { releaseDemo = resolve; });
  await page.route('**/api/demos/*', async route => {
    await demoGate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: route.request().url().endsWith('amazon') ? 'https://amazon.com/' : 'https://stripe.com/', total: 300, sampled: 2, captures: [capture(2000), capture(2005, 'Entirely different product and price')], firstTimestamp: '20000101000000', lastTimestamp: '20050101000000', unavailable: [] }) });
  });
  await page.route('**/api/jobs', route => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: 'a'.repeat(24), url: 'https://fixture.test/' }) }));
  await page.route('**/cache/ui-fixture.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="#f5f5f7"/><text x="70" y="200" font-family="sans-serif" font-size="36" fill="#6e6e73">UI fixture, not an archive capture</text></svg>' }));
  await page.goto(base);
  assert.equal(await page.locator('#url').inputValue(), 'stripe.com');
  assert.equal(await page.locator('#from').inputValue(), '');
  assert.equal(await page.locator('#to').inputValue(), '');
  assert.equal(await page.locator('#settings').getAttribute('open'), null);
  assert.equal(await page.locator('.entry-pending').count(), 8);
  assert.equal(await page.locator('h1').evaluate(n => getComputedStyle(n).fontSize), '44px');
  assert.equal(await page.locator('.page').evaluate(n => getComputedStyle(n).maxWidth), '880px');
  const widths = [320, 390, 768, 1440];
  async function snapshots(state) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${state} overflow at ${width}`);
      await page.screenshot({ path: `test-output/ui-${state}-${width}.png`, fullPage: true });
    }
  }
  await snapshots('finding');
  releaseDemo();
  await page.waitForFunction(() => document.getElementById('progress').hidden);
  assert.equal(await page.locator('.timeline-entry img').count(), 2);
  assert.equal(await page.locator('#from').getAttribute('placeholder'), '2000');
  assert.equal(await page.locator('#from').inputValue(), '');
  assert.match(await page.locator('#sampling-note').innerText(), /Cached example/);
  for (const preset of ['stripe.com', 'https://www.stripe.com/', 'amazon.com', 'https://www.amazon.com/']) {
    await page.locator('#url').fill(preset);
    await page.getByRole('button', { name: 'Explore history' }).click();
    await page.waitForFunction(() => document.getElementById('progress').hidden);
    assert.equal(jobRequests, 0, `Preset ${preset} must not POST a render job`);
  }
  await page.getByText('Settings', { exact: true }).click();
  await page.locator('#from').fill('1999');
  await page.locator('#count').selectOption('8');
  await page.locator('#url').fill('stripe.com');
  await page.getByRole('button', { name: 'Explore history' }).click();
  await page.waitForFunction(() => window.fixtureStream);
  assert.equal(jobRequests, 1, 'A custom preset date still starts a live job');
  assert.equal(await page.locator('.entry-pending').count(), 8, 'Initial lookup reserves requested samples');
  const emit = event => page.evaluate(event => window.emitFixture(event), event);
  await emit({ type: 'index', total: 300, sampled: 4, captures: selected, firstTimestamp: '19980101000000', lastTimestamp: '20260101000000' });
  assert.doesNotMatch(await page.locator('#sampling-note').innerText(), /Cached example/);
  assert.equal(await page.locator('#from').inputValue(), '1999', 'Metadata preserves user override');
  assert.equal(await page.locator('.entry-pending').count(), 4);
  await page.getByText('Settings', { exact: true }).click();
  await snapshots('pending');
  const positions = new Map();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    positions.set(width, await page.locator('.timeline-entry').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top + scrollY)));
  }
  const entriesBefore = await page.locator('.timeline-entry').evaluateAll(nodes => { window.originalSlots = nodes; return nodes.map(n => n.getBoundingClientRect().top + scrollY); });
  await emit({ type: 'capture', completed: 1, capture: capture(2005, 'Entirely new product\n<img src=x onerror="alert(1)">', '<img src=x onerror="alert(1)">') });
  await page.locator('.timeline-entry img').evaluate(n => { window.originalPreview = n; });
  assert.equal(await page.locator('.entry-pending').count(), 3);
  assert.deepEqual(await page.locator('.timeline-entry').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top + scrollY)), entriesBefore, 'Pending positions stay stable when a preview arrives');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const after = await page.locator('.timeline-entry').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top + scrollY));
    assert.ok(after.every((top, i) => Math.abs(top - positions.get(width)[i]) < 1), `Stable pending positions at ${width}`);
  }
  await emit({ type: 'capture', completed: 2, capture: capture(2000) });
  await emit({ type: 'capture', completed: 3, capture: capture(2001) });
  await emit({ type: 'capture', completed: 3, capture: capture(2001) });
  assert.equal(await page.locator('.timeline-entry').evaluateAll(nodes => nodes.every((n, i) => n === window.originalSlots[i])), true);
  assert.equal(await page.locator('img').last().evaluate(n => n === window.originalPreview), true);
  await snapshots('streaming');
  // A terminal event without the last result must expose the missing date.
  await emit({ type: 'done' });
  assert.equal(await page.locator('.timeline-entry').count(), 3);
  assert.equal(await page.locator('.entry-error').count(), 1);
  assert.match(await page.locator('#error').innerText(), /Partial results/);
  assert.match(await page.locator('#stats').innerText(), /2 text versions.*1 unavailable/);
  await page.getByRole('button', { name: 'All sampled', exact: true }).click();
  assert.equal(await page.locator('.timeline-entry').count(), 4);
  await page.getByRole('button', { name: 'Changes only', exact: true }).click();
  assert.equal(await page.locator('img').last().evaluate(n => n === window.originalPreview), true);
  await page.getByText('Settings', { exact: true }).click();
  await page.locator('#sensitivity').fill('100');
  assert.equal(await page.locator('#sensitivity-value').innerText(), '100%');
  await page.getByText('Settings', { exact: true }).click();
  await snapshots('partial');
  await page.getByRole('button', { name: 'Compare text', exact: true }).click();
  assert.equal(await page.locator('dialog').evaluate(n => n.open), true);
  assert.equal(await page.locator('#comparison img').count(), 0);
  assert.match(await page.locator('.added').first().innerText(), /Entirely new/);
  await page.getByRole('button', { name: 'Close comparison' }).click();
  await page.getByRole('button', { name: 'Amazon', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('progress').hidden);
  assert.equal(await page.locator('#from').inputValue(), '', 'Example resets automatic date');
  assert.equal(await page.locator('#site-title').innerText(), 'amazon.com');
  await page.locator('#url').fill('fixture.test');
  await page.getByRole('button', { name: 'Explore history' }).click();
  await page.waitForFunction(() => window.fixtureStreamCount === 2);
  await emit({ type: 'error', message: 'UI fixture connection error' });
  assert.equal(await page.locator('#error').innerText(), 'UI fixture connection error');
  assert.equal(await page.locator('#search-button').isEnabled(), true);
  await page.getByText('Settings', { exact: true }).click();
  await page.locator('#count').selectOption('16');
  await page.locator('#url').fill('stripe.com');
  await page.getByRole('button', { name: 'Explore history' }).click();
  await page.waitForFunction(() => window.fixtureStreamCount === 3);
  assert.equal(jobRequests, 3, 'A custom preset sample count still starts a live job');
  await emit({ type: 'error', message: 'UI fixture stopped' });
  // Both app and short blog pages use normal flex layout, never an overlay footer.
  for (const path of ['/', '/blog/missing-ui-fixture/']) {
    await page.goto(base + path);
    if (path === '/') { await page.waitForFunction(() => document.getElementById('progress').hidden); await page.evaluate(() => { document.querySelector('main').replaceChildren(); }); }
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      const footer = await page.locator('footer').evaluate(n => ({ bottom: n.getBoundingClientRect().bottom, position: getComputedStyle(n).position }));
      assert.ok(Math.abs(footer.bottom - (900 - 32)) < 2, `Footer at bottom: ${path} ${width}`);
      assert.equal(footer.position, 'static');
      assert.equal(await page.getByRole('link', { name: 'Built by Moritz Wallawitsch' }).getAttribute('href'), 'https://moritzw.com/');
      assert.equal(await page.getByRole('link', { name: 'GitHub', exact: true }).getAttribute('href'), 'https://github.com/moritzWa/better-wayback');
      await page.screenshot({ path: `test-output/ui-${path === '/' ? 'short-home' : 'short-blog'}-${width}.png`, fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: 320/390/768/1440 screenshots, delayed demo, settings, automatic dates and overrides, stable selected slots/preview nodes, deduplication, grouped failures, partial results, comparison/XSS, flex footers, no JS errors. UI fixtures only.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

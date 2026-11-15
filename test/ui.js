import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

await mkdir('test-output', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // UI fixture transport. No real archive job is started in this test.
    window.EventSource = class {
      constructor() { window.fixtureStream = this; }
      close() {}
    };
    window.emitFixture = event => window.fixtureStream.onmessage({ data: JSON.stringify(event) });
  });
  await page.goto('http://localhost:4317/');
  assert.equal(await page.getByRole('link', { name: 'Blog', exact: true }).getAttribute('href'), '/blog/');
  assert.equal(await page.locator('h1').evaluate(n => getComputedStyle(n).fontSize), '44px');
  assert.equal(await page.locator('.page').evaluate(n => getComputedStyle(n).maxWidth), '880px');
  assert.equal(await page.locator('body').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)');
  await page.screenshot({ path: 'test-output/home-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-output/home-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  // Deterministic UI-only data. Production never serves a fabricated history.
  const capture = (year, text, title) => ({ timestamp: `${year}0101000000`, original: 'https://example.com/', text, title, archiveUrl: `https://web.archive.org/web/${year}0101000000/https://example.com/`, image: '/cache/aaaaaaaaaaaaaaaaaaaaaaaa.png' });
  const events = [
    { type: 'index', total: 300, sampled: 4 },
    { type: 'capture', completed: 1, capture: capture(2000, 'A home for the old web\nOriginal product price $20', 'Example original') },
    { type: 'capture', completed: 2, capture: capture(2001, 'A home for the old web\nOriginal product price $20', 'Example original') },
    { type: 'capture', completed: 3, capture: capture(2005, 'An entirely new product for everyone\nNew product price $40\n<img src=x onerror="alert(1)">', '<img src=x onerror="alert(1)">') },
    { type: 'capture', completed: 4, capture: { timestamp: '20100101000000', original: 'https://example.com', error: 'Incomplete archive replay' } },
    { type: 'done' }
  ];
  await page.route('**/api/jobs', route => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: 'a'.repeat(24), url: 'https://example.com/' }) }));
  await page.route('**/cache/aaaaaaaaaaaaaaaaaaaaaaaa.png', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="#f5f5f7"/><text x="70" y="200" font-family="sans-serif" font-size="36" fill="#6e6e73">UI fixture, not an archive capture</text></svg>' }));
  await page.locator('#url').fill('example.com');
  await page.locator('#search-button').click();
  await page.waitForFunction(() => window.fixtureStream);
  const emit = event => page.evaluate(event => window.emitFixture(event), event);
  await emit(events[0]);
  // Concurrent renders may complete newest first. Keep chronology and image identity.
  await emit(events[3]);
  await page.locator('.timeline-entry img').evaluate(n => { window.originalPreview = n; });
  await emit(events[1]);
  assert.deepEqual(await page.locator('.entry-date').allTextContents(), ['2000', '2005']);
  assert.equal(await page.locator('.timeline-entry img').last().evaluate(n => n === window.originalPreview), true);
  await emit(events[2]);
  await emit(events[2]); // Replayed capture events must not duplicate entries.
  await emit(events[4]);
  await emit(events[5]);
  await page.waitForFunction(() => document.getElementById('progress').hidden);
  assert.equal(await page.locator('.timeline-entry').count(), 2);
  assert.match(await page.locator('#stats').innerText(), /2 text versions.*1 unavailable/);
  await page.getByRole('button', { name: 'All sampled', exact: true }).click();
  assert.equal(await page.locator('.timeline-entry').count(), 4);
  await page.getByRole('button', { name: 'Changes only', exact: true }).click();
  assert.equal(await page.locator('.timeline-entry img').last().evaluate(n => n === window.originalPreview), true);
  await page.locator('#sensitivity').fill('100');
  assert.equal(await page.locator('#sensitivity-value').innerText(), '100%');
  assert.equal(await page.locator('.timeline-entry img').last().evaluate(n => n === window.originalPreview), true);
  await page.screenshot({ path: 'test-output/timeline-fixture-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Compare text', exact: true }).click();
  assert.equal(await page.locator('dialog').evaluate(n => n.open), true);
  assert.match(await page.locator('.added').first().innerText(), /entirely new/);
  assert.equal(await page.locator('#comparison img').count(), 0);
  await page.screenshot({ path: 'test-output/comparison-fixture-mobile.png' });
  await page.getByRole('button', { name: 'Close comparison' }).click();
  assert.equal(await page.locator('dialog').evaluate(n => n.open), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: 'test-output/timeline-fixture-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Compare text', exact: true }).click();
  await page.screenshot({ path: 'test-output/comparison-fixture-desktop.png' });
  await page.getByRole('button', { name: 'Close comparison' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}px`);
  }
  await page.getByRole('button', { name: 'Explore history' }).click();
  assert.equal(await page.locator('.timeline-entry').count(), 0, 'New search clears previous entries');
  await emit({ type: 'error', message: 'UI fixture connection error' });
  assert.equal(await page.locator('#error').innerText(), 'UI fixture connection error');
  assert.equal(await page.locator('#search-button').isEnabled(), true);
  // XSS must stay inert in archived titles/text.
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: reference tokens, desktop/mobile, out-of-order stream, stable preview nodes, deduplication, slider, all-sampled toggle, comparison dialog, inert XSS, no overflow or JS errors. Timeline screenshots use labeled fixtures.');
} finally { await browser.close(); }

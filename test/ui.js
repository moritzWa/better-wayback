import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

await mkdir('test-output', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:4317/');
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
  await page.route('**/api/jobs/*/events', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') }));
  await page.route('**/cache/aaaaaaaaaaaaaaaaaaaaaaaa.png', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="#e5e8dc"/><text x="100" y="200" font-size="45">UI test fixture, not an archive capture</text></svg>' }));
  await page.locator('#url').fill('example.com');
  await page.locator('#search-button').click();
  await page.locator('.timeline-entry').nth(1).waitFor();
  await page.waitForFunction(() => document.getElementById('progress').hidden);
  assert.equal(await page.locator('.timeline-entry').count(), 2);
  assert.match(await page.locator('#stats').innerText(), /2 text versions.*1 unavailable/);
  await page.getByRole('button', { name: 'All sampled', exact: true }).click();
  assert.equal(await page.locator('.timeline-entry').count(), 4);
  await page.getByRole('button', { name: 'Changes only', exact: true }).click();
  await page.getByRole('button', { name: 'Compare text', exact: true }).click();
  assert.equal(await page.locator('dialog').evaluate(n => n.open), true);
  assert.match(await page.locator('.added').first().innerText(), /entirely new/);
  assert.equal(await page.locator('#comparison img').count(), 0);
  await page.getByRole('button', { name: 'Close comparison' }).click();
  assert.equal(await page.locator('dialog').evaluate(n => n.open), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  // XSS must stay inert in archived titles/text.
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: desktop/mobile, stream updates, deduplication, all-sampled toggle, comparison dialog, no overflow or JS errors');
} finally { await browser.close(); }

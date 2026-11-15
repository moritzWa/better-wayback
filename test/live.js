// Optional live integration check. Fetches real Internet Archive data via the app.
// Start the server first. Not part of the deterministic unit/UI suite.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

await mkdir('test-output', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:4317/?url=stripe.com&from=2012&to=2026&count=8');
  await page.waitForFunction(() => document.getElementById('progress').hidden, null, { timeout: 900000 });
  assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').innerText());
  assert.match(await page.locator('#stats').innerText(), /8\/8 sampled/);
  assert.ok(await page.locator('.timeline-entry').count() >= 2);
  assert.ok(await page.locator('.preview-link img').count() >= 2);
  for (const image of await page.locator('.preview-link img').all()) {
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(img => img.decode());
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'test-output/stripe-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Compare text', exact: true }).first().click();
  assert.ok(await page.locator('.diff-text .added').count() > 0);
  await page.screenshot({ path: 'test-output/stripe-comparison.png' });
  await page.getByRole('button', { name: 'Close comparison' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.getElementById('results').scrollIntoView());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'test-output/stripe-mobile.png' });
  assert.deepEqual(errors, []);
  console.log(`PASS real archive flow: ${await page.locator('#stats').innerText()}; desktop/mobile screenshots and actual-text comparison verified.`);
} finally { await browser.close(); }

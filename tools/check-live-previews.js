// Real archive UI check. CDP must point to a dedicated muted Linux Space browser.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.LIVE_BASE || 'https://visualwayback.com';
const output = process.env.LIVE_OUTPUT || '/Users/m/Documents/visual-wayback/html-first-browser';
const browser = await chromium.connectOverCDP('http://localhost:19831');
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.__capturePaints = [];
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.__capturePaints.push({ name: e.name, ms: e.startTime }); }).observe({ type: 'paint', buffered: true });
  });
  const page = await context.newPage();
  const start = Date.now();
  await page.goto(`${base}/?url=rogo.ai&from=2026&to=2026`);
  const metadataDone = page.waitForFunction(() => !document.querySelector('#search-button').disabled && document.querySelector('#stats').textContent.includes('8/8 sampled'), undefined, { timeout: 45000 }).then(() => Date.now() - start);
  await page.waitForSelector('.live-frame[src]', { timeout: 30000 });
  const iframeAttachedMs = Date.now() - start;
  const handle = await page.locator('.live-frame[src]').first().elementHandle();
  const frame = await handle.contentFrame();
  await frame.waitForURL(url => url.hostname === 'web.archive.org', { timeout: 20000 });
  await frame.waitForFunction(() => [...document.querySelectorAll('h1,h2')].some(el => {
    if (!el.textContent.trim() || el.getBoundingClientRect().width <= 2) return false;
    for (let n = el; n instanceof Element; n = n.parentElement) {
      const s = getComputedStyle(n); if (s.visibility !== 'visible' || Number(s.opacity) < .95) return false;
    }
    return true;
  }), undefined, { timeout: 25000 });
  const visibleHeadingMs = Date.now() - start;
  const allMetadataMs = await metadataDone;
  const residentLimit = await page.evaluate(() => navigator.connection?.saveData || navigator.deviceMemory <= 4 ? 4 : navigator.deviceMemory ? 8 : 6);
  assert.ok(await page.locator('.live-frame[src]').count() <= residentLimit);
  assert.ok(await page.locator('[data-preview-state="loading"]').count() <= 2);
  assert.equal(await page.evaluate(() => document.querySelector('.live-frame[src]').contentDocument), null);
  assert.equal(await page.locator('.live-frame').first().getAttribute('sandbox'), 'allow-scripts allow-same-origin');
  const parentOrigin = await page.evaluate(() => performance.timeOrigin);
  const framePaint = await frame.evaluate(() => ({ origin: performance.timeOrigin, paint: window.__capturePaints.find(e => e.name === 'first-contentful-paint')?.ms }));
  const result = { base, iframeAttachedMs, firstContentfulPaintMs: framePaint.paint === undefined ? null : Math.round(framePaint.origin + framePaint.paint - parentOrigin), visibleHeadingMs, allMetadataMs, stats: await page.locator('#stats').innerText(), errors: await page.locator('#error').innerText(), loadedFrames: await page.locator('.live-frame[src]').count(), frameHeadings: await frame.locator('h1,h2').allTextContents(), frameUrl: frame.url() };
  assert.equal(result.errors, '', 'real HTML lookups should complete without a hidden partial failure');
  await page.locator('.timeline-entry').first().screenshot({ path: output + '-1440.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.timeline-entry').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.body.scrollWidth <= innerWidth);
  await page.locator('.timeline-entry').first().screenshot({ path: output + '-390.png' });
  const compare = page.locator('.compare-button:visible').first();
  if (await compare.count()) {
    await compare.click(); assert.match(await page.locator('.compare-note').innerText(), /archived HTML/); await page.locator('#close-dialog').click();
  }
  await page.locator('[data-site="stripe.com"]').click();
  await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
  assert.equal(await page.locator('.live-frame').count(), 0);
  await page.locator('#timeline img').first().evaluate(img => img.decode());
  assert.match(await page.locator('#stats').innerText(), /4\/4 sampled/);
  result.cachedStripeStillWorks = true;
  await writeFile(output + '.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await context.close();
} finally {
  try { const session = await browser.newBrowserCDPSession(); await session.send('Browser.close'); } catch {}
  await browser.close().catch(() => {});
}

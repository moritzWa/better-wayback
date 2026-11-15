// Headless integration check against the real running app and static blog routes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { launchRendererBrowser } from '../renderer.js';

await mkdir('test-output', { recursive: true });
const browser = await launchRendererBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to/.test(message.text())) errors.push(message.text()); });
  await page.goto('http://localhost:4317/');
  assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), 'https://betterwaybackmachine.com/');
  await page.getByRole('link', { name: 'Blog', exact: true }).first().click();
  assert.ok(page.url().endsWith('/blog/'));
  await page.screenshot({ path: 'test-output/blog-index-desktop.png', fullPage: true });
  for (const slug of ['wayback-machine-alternatives', 'history-of-the-wayback-machine']) {
    const path = `/blog/${slug}/`;
    const response = await page.goto(`http://localhost:4317${path}`);
    assert.equal(response.status(), 200);
    assert.equal(await page.locator('h1').count(), 1);
    assert.ok(await page.locator('script[type="application/ld+json"]').count());
    for (const script of await page.locator('script[type="application/ld+json"]').all()) JSON.parse(await script.textContent());
    const head = await page.request.head(`http://localhost:4317${path}`);
    assert.equal(head.status(), 200);
    assert.equal((await head.body()).length, 0);
    assert.ok(head.headers()['content-security-policy'].includes('sha256-'));
    await page.screenshot({ path: `test-output/blog-${slug}-desktop.png` });
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${slug} at ${width}px`);
    }
    await page.screenshot({ path: `test-output/blog-${slug}-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 1100 });
  }
  const sitemap = await page.request.get('http://localhost:4317/sitemap.xml');
  assert.equal(sitemap.status(), 200);
  assert.match(await sitemap.text(), /history-of-the-wayback-machine/);
  const notFound = await page.request.get('http://localhost:4317/blog/does-not-exist/');
  assert.equal(notFound.status(), 404);
  assert.match(await notFound.text(), /noindex/);
  assert.deepEqual(errors, []);
  console.log('PASS: real app/blog navigation, article metadata and JSON-LD, CSP, HEAD, sitemap, 404, and 320/390/768px layouts');
} finally { await browser.close(); }

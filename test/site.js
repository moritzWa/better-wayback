// Headless integration check against the real running app and static blog routes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { launchRendererBrowser } from '../renderer.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

await mkdir('test-output', { recursive: true });
// A fresh bounded process picks up the static blog module without touching the review server.
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server did not start')), 10000);
    server.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/localhost:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited ${code}`)); });
  });
  browser = await launchRendererBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to/.test(message.text())) errors.push(message.text()); });
  await page.goto(base + '/');
  assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), 'https://betterwaybackmachine.com/');
  await page.waitForFunction(() => document.getElementById('progress').hidden);
  const demoResponse = await page.request.get(base + '/api/demos/stripe');
  assert.equal(demoResponse.status(), 200);
  const demo = await demoResponse.json();
  assert.ok(demo.captures.length >= 2, 'Real packaged Stripe history must include multiple dates');
  assert.equal(await page.locator('#url').inputValue(), 'stripe.com');
  assert.equal(await page.locator('#count').inputValue(), '8', 'Demo size must not blank the sample selector');
  assert.equal(await page.locator('#from').inputValue(), '');
  assert.equal(await page.locator('#from').getAttribute('placeholder'), demo.firstTimestamp.slice(0, 4));
  for (const image of await page.locator('.timeline-entry img').all()) {
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(n => n.decode());
    assert.ok(await image.evaluate(n => n.naturalWidth > 0));
  }
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-output/real-stripe-${width}.png`, fullPage: true });
  }
  const amazonResponse = await page.request.get(base + '/api/demos/amazon');
  assert.equal(amazonResponse.status(), 200);
  const amazon = await amazonResponse.json();
  assert.ok(amazon.captures.length >= 2, 'Real Amazon history must include multiple dates');
  await page.getByRole('button', { name: 'Amazon', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('progress').hidden && document.getElementById('site-title').textContent.includes('amazon'));
  await page.getByRole('button', { name: 'All sampled', exact: true }).click();
  assert.equal(await page.locator('.timeline-entry img').count(), amazon.captures.length);
  for (const image of await page.locator('.timeline-entry img').all()) { await image.scrollIntoViewIfNeeded(); await image.evaluate(n => n.decode()); }
  if (amazon.unavailable.length) assert.match(await page.locator('#error').innerText(), /Partial cached history/);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-output/real-amazon-${width}.png`, fullPage: true });
  }
  await page.getByRole('link', { name: 'Blog', exact: true }).first().click();
  assert.ok(page.url().endsWith('/blog/'));
  await page.screenshot({ path: 'test-output/blog-index-desktop.png', fullPage: true });
  for (const slug of ['wayback-machine-alternatives', 'history-of-the-wayback-machine']) {
    const path = `/blog/${slug}/`;
    const response = await page.goto(base + path);
    assert.equal(response.status(), 200);
    assert.equal(await page.locator('h1').count(), 1);
    assert.ok(await page.locator('script[type="application/ld+json"]').count());
    for (const script of await page.locator('script[type="application/ld+json"]').all()) JSON.parse(await script.textContent());
    const head = await page.request.head(base + path);
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
  const sitemap = await page.request.get(base + '/sitemap.xml');
  assert.equal(sitemap.status(), 200);
  assert.match(await sitemap.text(), /history-of-the-wayback-machine/);
  const notFound = await page.request.get(base + '/blog/does-not-exist/');
  assert.equal(notFound.status(), 404);
  assert.match(await notFound.text(), /noindex/);
  assert.deepEqual(errors, []);
  console.log('PASS: real packaged Stripe/Amazon previews decoded, unavailable summary, default count/automatic dates, 320/390/768/1440 real timeline screenshots, app/blog navigation, article metadata/JSON-LD, CSP, HEAD, sitemap and 404.');
} finally {
  await browser?.close();
  if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; }
}

// Record the real deployed UI, using genuine packaged archive captures, in a muted Space.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const base = process.env.DEMO_BASE || 'https://visualwayback.com';
const output = resolve(process.env.DEMO_OUTPUT || '/Users/m/Documents/visual-wayback/demo-video');
await mkdir(resolve(output, 'frames'), { recursive: true });
const browser = await chromium.connectOverCDP(process.env.DEMO_CDP || 'http://localhost:19832');
let context, session;
const frames = [], scenes = [], writes = [];
let started;
try {
  context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
  async function ready(site) {
    await page.locator(`[data-site="${site}.com"]`).click();
    await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
    await page.locator('#all-view').click();
    await page.locator('#timeline img').evaluateAll(images => Promise.all(images.map(img => { img.loading = 'eager'; return img.decode(); })));
    if (await page.locator('.live-frame').count()) throw new Error('Demo unexpectedly used a live iframe instead of the genuine packaged captures.');
  }
  // Warm every asset outside the recorded scenes. No loading delay is represented as app speed.
  for (const site of ['openai', 'anthropic', 'nvidia']) await ready(site);
  async function scrollEntry(which, duration = 0) {
    const entry = which === 'first' ? page.locator('.timeline-entry').first() : page.locator('.timeline-entry').last();
    const y = await entry.evaluate(n => n.getBoundingClientRect().top + scrollY - 18);
    await page.evaluate(async ({ y, duration }) => {
      if (!duration) { scrollTo(0, y); return; }
      const start = performance.now(), from = scrollY;
      await new Promise(resolve => {
        const move = now => { const t = Math.min(1, (now - start) / duration), ease = t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2; scrollTo(0, from + (y - from) * ease); if (t < 1) requestAnimationFrame(move); else resolve(); };
        requestAnimationFrame(move);
      });
    }, { y, duration });
  }
  await ready('openai'); await scrollEntry('first');
  await page.evaluate(() => {
    const cursor = document.createElement('div'); cursor.id = 'demo-recording-cursor';
    Object.assign(cursor.style, { position: 'fixed', width: '14px', height: '14px', border: '2px solid #1d1d1f', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px #0004', pointerEvents: 'none', zIndex: '2147483647', left: '-40px', top: '-40px' });
    document.body.append(cursor);
    document.addEventListener('mousemove', e => { cursor.style.left = `${e.clientX - 7}px`; cursor.style.top = `${e.clientY - 7}px`; });
    document.addEventListener('mousedown', () => cursor.animate([{ transform: 'scale(1)' }, { transform: 'scale(.65)' }, { transform: 'scale(1)' }], { duration: 250 }));
  });
  await page.mouse.move(1130, 640);
  await page.screenshot();
  session = await context.newCDPSession(page);
  let firstFrame;
  const first = new Promise(resolve => { firstFrame = resolve; });
  session.on('Page.screencastFrame', event => {
    const now = performance.now(); started ??= now;
    const file = `frames/${String(frames.length).padStart(6, '0')}.jpg`;
    frames.push({ file, seconds: (now - started) / 1000 });
    writes.push(writeFile(resolve(output, file), Buffer.from(event.data, 'base64')));
    void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    firstFrame();
  });
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await first;
  const elapsed = () => (performance.now() - started) / 1000;
  for (const site of ['openai', 'anthropic', 'nvidia']) {
    if (site !== 'openai') { await ready(site); await scrollEntry('first'); await page.waitForTimeout(400); }
    const start = site === 'openai' ? 0 : elapsed();
    await page.waitForTimeout(1900);
    await scrollEntry('last', 650);
    await page.waitForTimeout(1900);
    scenes.push({ name: site, start, end: elapsed() });
  }
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(400);
  let start = elapsed();
  const button = page.locator('[data-site="openai.com"]'), box = await button.boundingBox();
  await page.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 20 }); await page.waitForTimeout(350); await button.click();
  await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
  await page.waitForTimeout(450); await scrollEntry('first', 1000); await page.waitForTimeout(2000);
  scenes.push({ name: 'timeline', start, end: elapsed() });
  await scrollEntry('last'); await page.waitForTimeout(400);
  start = elapsed();
  const compare = page.getByRole('button', { name: 'Compare text', exact: true }).last(), compareBox = await compare.boundingBox();
  await page.mouse.move(compareBox.x + compareBox.width/2, compareBox.y + compareBox.height/2, { steps: 20 });
  await page.waitForTimeout(300); await compare.click(); await page.waitForFunction(() => document.querySelector('#compare-dialog').open); await page.waitForTimeout(2200);
  await page.locator('#close-dialog').click(); await page.waitForTimeout(450);
  const open = page.locator('.card-actions a').last(), openBox = await open.boundingBox();
  await page.mouse.move(openBox.x + openBox.width/2, openBox.y + openBox.height/2, { steps: 20 }); await page.waitForTimeout(750);
  scenes.push({ name: 'compare', start, end: elapsed() });
  const end = elapsed();
  await session.send('Page.stopScreencast'); session.removeAllListeners('Page.screencastFrame'); await Promise.all(writes);
  await writeFile(resolve(output, 'recording.json'), JSON.stringify({ base, recordedAt: new Date().toISOString(), viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, editedForBrevity: true, frames, scenes, end }, null, 2));
  console.log(JSON.stringify({ frames: frames.length, scenes, end, output }));
} finally {
  await context?.close();
  // Dedicated task profile only, never a login/shared browser.
  try { const close = await browser.newBrowserCDPSession(); await close.send('Browser.close'); } catch {}
  await browser.close().catch(() => {});
}

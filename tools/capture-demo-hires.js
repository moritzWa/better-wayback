// Native 4K lossless product frames. Never enlarge 720p screencast frames.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { archiveRequestAllowed, renderPage } from '../renderer.js';
import { USER_AGENT } from '../lib.js';

const output = resolve(process.env.DEMO_OUTPUT || '/Users/m/Documents/visual-wayback/demo-video/high-res');
await mkdir(resolve(output, 'archive'), { recursive: true });
const browser = await chromium.connectOverCDP(process.env.DEMO_CDP || 'http://localhost:19832');
const sources = [], scenes = [];
try {
  for (const [name, timestamps] of [['openai', ['20190107133421', '20230101012158']], ['nvidia', ['20070101232936', '20130211005742', '20250101074126']]]) {
    const manifest = JSON.parse(await readFile(`demos/${name}.json`, 'utf8'));
    for (const timestamp of timestamps) {
      const capture = manifest.captures.find(c => c.timestamp === timestamp);
      const file = resolve(output, 'archive', `${name}-${timestamp}.png`);
      let saved;
      try { saved = JSON.parse(await readFile(file + '.json', 'utf8')); await readFile(file); } catch {}
      if (!saved) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 3, userAgent: USER_AGENT, serviceWorkers: 'block', acceptDownloads: false });
        const deadline = setTimeout(() => { void context.close(); }, 95000);
        try {
          await context.route('**/*', route => archiveRequestAllowed(route.request().url()) ? route.continue() : route.abort());
          await context.routeWebSocket('**/*', socket => socket.close());
          context.on('page', page => { page.on('dialog', d => d.dismiss()); page.on('popup', p => p.close()); });
          const page = await context.newPage();
          saved = await renderPage(page, capture, file, { readinessTimeoutMs: 50000 });
          if (saved.timestamp !== timestamp) throw new Error(`Replay moved from ${timestamp} to ${saved.timestamp}; do not substitute a different date in the product frame.`);
          await writeFile(file + '.json', JSON.stringify(saved, null, 2));
        } finally { clearTimeout(deadline); await context.close(); }
      }
      sources.push({ name, timestamp, image: capture.image, file, title: saved.title, archiveUrl: saved.archiveUrl });
      console.log(JSON.stringify({ captured: name, timestamp, file }));
    }
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3, serviceWorkers: 'block' });
  try {
    // Same genuine dates and contents, rephotographed at DPR 3 for the video only.
    // The production site's PNG files and manifest are not modified.
    await context.route('**/demos/**/*.png', async route => {
      const source = sources.find(s => new URL(route.request().url()).pathname === s.image);
      if (source) await route.fulfill({ contentType: 'image/png', body: await readFile(source.file) });
      else await route.continue();
    });
    const page = await context.newPage();
    await page.goto('https://visualwayback.com/');
    await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
    for (const name of ['openai', 'nvidia']) {
      await page.locator(`[data-site="${name}.com"]`).click();
      await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
      await page.locator('#all-view').click();
      await page.locator('#timeline img').evaluateAll(images => Promise.all(images.map(img => { img.loading = 'eager'; return img.decode(); })));
      for (const source of sources.filter(s => s.name === name)) {
        const img = page.locator(`#timeline img[src="${source.image}"]`);
        if (await img.evaluate(n => n.naturalWidth) !== 3840) throw new Error('Archive image is not native high resolution');
        await img.evaluate(n => { const card = n.closest('.timeline-entry'); scrollTo(0, card.getBoundingClientRect().top + scrollY - 24); });
        await page.waitForTimeout(150);
        const file = `${name}-${source.timestamp}.png`;
        await page.screenshot({ path: resolve(output, file), type: 'png', scale: 'device' });
        scenes.push({ name, timestamp: source.timestamp, file });
      }
    }
    await page.locator('[data-site="nvidia.com"]').click();
    await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: resolve(output, 'overview.png'), type: 'png', scale: 'device' });
    scenes.push({ name: 'overview', file: 'overview.png' });
  } finally { await context.close(); }
  await writeFile(resolve(output, 'capture.json'), JSON.stringify({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3, pixels: [3840, 2160], sources, scenes, noUpscaling: true, noComparisonDialog: true, source: 'https://visualwayback.com/' }, null, 2));
  console.log('Native 3840×2160 PNG scenes ready.');
} finally {
  try { const session = await browser.newBrowserCDPSession(); await session.send('Browser.close'); } catch {}
  await browser.close().catch(() => {});
}

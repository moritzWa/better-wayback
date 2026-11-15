// Reproducible real-browser scroll recording, frame by frame at native 4K.
// Screenshot sampling avoids CDP screencast's 720p ceiling; no still-image pans.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.env.DEMO_OUTPUT || '/Users/m/Documents/visual-wayback/demo-video/motion');
const hires = resolve(process.env.DEMO_HIRES || '/Users/m/Documents/visual-wayback/demo-video/high-res');
await mkdir(root, { recursive: true });
const sources = JSON.parse(await readFile(resolve(hires, 'capture.json'), 'utf8')).sources;
const browser = await chromium.connectOverCDP(process.env.DEMO_CDP || 'http://localhost:19832');
const scenes = [];
let context;
try {
  context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3, serviceWorkers: 'block' });
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
    if (name === 'openai') {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: resolve(root, 'intro.png'), scale: 'device' });
    }
    const timestamps = name === 'openai' ? ['20190107133421', '20230101012158'] : ['20130211005742', '20250101074126'];
    const offsets = [];
    for (const timestamp of timestamps) {
      const source = sources.find(s => s.name === name && s.timestamp === timestamp);
      const image = page.locator(`img[src="${source.image}"]`);
      if (await image.evaluate(n => n.naturalWidth) !== 3840) throw new Error('Settled endpoint is not a native high-resolution archive capture.');
      offsets.push(await image.evaluate(n => n.closest('.timeline-entry').getBoundingClientRect().top + scrollY - 28));
    }
    const directory = resolve(root, name); await mkdir(directory, { recursive: true });
    const frames = [];
    // Hold the starting year, ease through the real timeline, then settle at the ending year.
    // Each output frame is captured after scrollTo updates and a browser animation frame.
    for (let i = 0; i < 120; i++) {
      const t = i / 119, progress = Math.min(1, Math.max(0, (t - .23) / .53));
      const eased = progress < .5 ? 4*progress**3 : 1-(-2*progress+2)**3/2;
      const requestedY = offsets[0] + (offsets[1] - offsets[0]) * eased;
      const actualY = await page.evaluate(async y => { scrollTo(0, y); await new Promise(requestAnimationFrame); return scrollY; }, requestedY);
      if (await page.locator('#compare-dialog').evaluate(n => n.open)) throw new Error('Comparison dialog must not be part of the recording.');
      const file = `${name}/${String(i).padStart(4, '0')}.jpg`;
      await page.screenshot({ path: resolve(root, file), type: 'jpeg', quality: 97, scale: 'device' });
      frames.push({ file, scrollY: actualY, requestedY });
    }
    if (new Set(frames.map(f => f.scrollY)).size < 40) throw new Error('Scroll recording did not move through enough distinct page positions.');
    scenes.push({ name, timestamps, frames, sourceFrames: 120, fps: 30, offsets });
    console.log(JSON.stringify({ recorded: name, distinctScrollPositions: new Set(frames.map(f => f.scrollY)).size, offsets }));
  }
  // Original Internet Archive glyph and wordmark from its own top navigation bundle.
  const sourceURL = 'https://archive.org/offshoot_assets/vendor-topnav-Dcg-INpV.js';
  const response = await fetch(sourceURL, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Official Internet Archive logo source unavailable');
  const bundle = await response.text();
  const glyph = bundle.match(/[,;]V=u`(<svg[\s\S]*?<\/svg>)`/)?.[1];
  const wordmark = bundle.match(/[,;]ie=u`(<svg[\s\S]*?<\/svg>)`/)?.[1];
  if (!glyph || !wordmark) throw new Error('Official logo format changed; do not substitute guessed artwork.');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 32"><g transform="translate(1 1)">${glyph.replace(/<svg[^>]*>|<\/svg>/g, '')}</g><g transform="translate(36 1)">${wordmark.replace(/<svg[^>]*>|<\/svg>/g, '')}</g></svg>`;
  await writeFile(resolve(root, 'internet-archive-logo.svg'), svg);
  const logo = await context.newPage();
  await logo.setContent(`<style>body{margin:0;background:transparent}svg{width:440px;height:107px;display:block}</style>${svg}`);
  await logo.locator('svg').screenshot({ path: resolve(root, 'internet-archive-logo.png'), omitBackground: true, scale: 'device' });
  await writeFile(resolve(root, 'capture.json'), JSON.stringify({ viewport: [1280,720], deviceScaleFactor: 3, pixels: [3840,2160], source: 'https://visualwayback.com/', scenes, logoSource: sourceURL, originalLogoColors: true, noComparisonDialog: true, editedForBrevity: true }, null, 2));
  console.log('Two native-4K real scroll sequences and official Internet Archive logo ready.');
} finally {
  await context?.close();
  try { const session = await browser.newBrowserCDPSession(); await session.send('Browser.close'); } catch {}
  await browser.close().catch(() => {});
}

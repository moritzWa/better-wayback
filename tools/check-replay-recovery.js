// Real network evidence. Reuses recorded metadata, but never mocks Archive documents/assets.
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [eventsFile, output, source = '.'] = process.argv.slice(2);
if (!eventsFile || !output) throw new Error('Usage: node tools/check-replay-recovery.js events.txt output-dir [source-root]');
await mkdir(output, { recursive: true });
const events = await readFile(eventsFile, 'utf8');
const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const observations = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('https://recovery.invalid/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/jobs') return route.fulfill({ json: { id: 'recorded', url: 'https://a16z.com/' } });
    if (pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: events });
    const file = pathname === '/' ? 'public/index.html' : ['group.js'].includes(pathname.slice(1)) ? pathname.slice(1) : `public${pathname}`;
    try {
      const body = await readFile(path.resolve(source, file));
      return route.fulfill({ body, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  page.on('requestfailed', request => {
    if (request.isNavigationRequest()) observations.push({ event: 'navigation-failed', url: request.url(), error: request.failure() });
  });
  await page.goto('https://recovery.invalid/?url=a16z.com');
  await page.locator('.timeline-entry').nth(7).waitFor();
  for (const year of ['2009', '2016', '2021']) {
    const entry = page.locator('.timeline-entry').filter({ has: page.locator('.entry-date', { hasText: year }) }).first();
    const started = Date.now();
    await entry.scrollIntoViewIfNeeded();
    // Scroll back through an earlier card after its offscreen preload deadline.
    await page.waitForTimeout(24000);
    const preview = entry.locator('.live-preview');
    const frame = await entry.locator('iframe').elementHandle();
    const child = frame && await frame.contentFrame();
    const content = child && await child.evaluate(() => ({ title: document.title, text: document.body?.innerText?.slice(0, 400), images: document.images.length })).catch(() => null);
    observations.push({ year, elapsedMs: Date.now() - started, state: await preview.getAttribute('data-preview-state'), status: await entry.locator('.live-status').textContent(), frameUrl: child?.url(), content });
    await entry.screenshot({ path: `${output}/a16z-${year}.png` });
  }
} finally {
  await browser.close();
  await writeFile(`${output}/observations.json`, JSON.stringify(observations, null, 2));
  console.log(JSON.stringify(observations, null, 2));
}

import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanText, fetchCaptures, keyFor, replayUrl, selectCaptures, USER_AGENT } from './lib.js';

const [url, from, to, countArg] = process.argv.slice(2);
const cache = resolve('.cache');
const emit = data => process.stdout.write(JSON.stringify(data) + '\n');
await mkdir(cache, { recursive: true });
let browser;
try {
  emit({ type: 'status', message: 'Finding archived captures…' });
  const rows = await fetchCaptures(url, from, to);
  const selected = selectCaptures(rows, Number(countArg));
  emit({ type: 'index', total: rows.indexTotal, capped: rows.indexCapped, monthly: rows.indexCapped, sampled: selected.length });
  if (!selected.length) throw new Error('No successful captures found for this URL and date range. Try a wider range or the www version.');
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  let completed = 0;
  for (const capture of selected) {
    const key = keyFor(capture.timestamp + capture.original + ':render-v1');
    try {
      const saved = JSON.parse(await readFile(resolve(cache, key + '.json'), 'utf8'));
      emit({ type: 'capture', capture: saved, completed: ++completed });
      continue;
    } catch {}
    emit({ type: 'status', message: `Rendering ${capture.timestamp.slice(0, 4)} · ${completed + 1} of ${selected.length}` });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: USER_AGENT, serviceWorkers: 'block', acceptDownloads: false });
    // Archived scripts are untrusted. Never allow live-site or local-network fallback.
    await context.route('**/*', route => {
      const target = new URL(route.request().url());
      if (target.protocol === 'https:' && target.hostname === 'web.archive.org') return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.dismiss());
    page.on('popup', popup => popup.close());
    try {
      const response = await page.goto(replayUrl(capture.timestamp, capture.original), { waitUntil: 'domcontentloaded', timeout: 35000 });
      if (response && response.status() >= 400) throw new Error(`Archive returned HTTP ${response.status()}`);
      await page.waitForTimeout(2200);
      await page.addStyleTag({ content: '#wm-ipp-base, #wm-ipp-print, #donato, .wb-autocomplete-suggestions { display:none!important; } html { scroll-behavior:auto!important; } * { animation:none!important; transition:none!important; }' });
      const text = cleanText(await page.locator('body').innerText({ timeout: 5000 }));
      if (text.length < 60 || /Wayback Machine has not archived that URL|This URL has been excluded|Your IP address has reached|Rate limit exceeded|The Wayback Machine has not archived/i.test(text)) throw new Error('Incomplete or unavailable archive replay');
      const finalUrl = page.url();
      const actualTimestamp = finalUrl.match(/\/web\/(\d{14})/)?.[1] || capture.timestamp;
      const title = (await page.title()).replace(/\s*[-|]\s*Wayback Machine$/, '');
      await page.screenshot({ path: resolve(cache, key + '.png'), animations: 'disabled', timeout: 10000 });
      const result = { ...capture, timestamp: actualTimestamp, requestedTimestamp: capture.timestamp, text, title, image: `/cache/${key}.png`, archiveUrl: replayUrl(actualTimestamp, capture.original) };
      await writeFile(resolve(cache, key + '.json'), JSON.stringify(result));
      emit({ type: 'capture', capture: result, completed: ++completed });
    } catch (error) {
      emit({ type: 'capture', capture: { ...capture, error: error.message }, completed: ++completed });
    } finally {
      await context.close();
    }
  }
  emit({ type: 'done' });
} catch (error) {
  emit({ type: 'error', message: error.message });
  process.exitCode = 1;
} finally {
  await browser?.close();
}

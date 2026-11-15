// Run through heavy-job.py --wait. Exact real-archive reproduction, not a live-site fallback.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { USER_AGENT, replayUrl } from '../lib.js';
import { isolatedContext, renderCapture, renderPage } from '../renderer.js';

const dir = resolve('test-output/harvey-renderer');
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
if (process.argv.includes('--fixed') || process.argv.includes('--replay')) {
  let replayContext;
  try {
    const replay = process.argv.includes('--replay');
    const capture = { timestamp: '20240218234204', original: 'https://www.harvey.ai/' };
    const name = replay ? 'recorded-fixed' : 'fixed';
    let result;
    if (replay) {
      replayContext = await isolatedContext(browser);
      const har = JSON.parse(await readFile(resolve(dir, 'archive.har'), 'utf8'));
      // HAR records aborted live/static requests as status -1, which cannot be fulfilled.
      har.log.entries = har.log.entries.filter(entry => entry.response.status >= 200);
      await writeFile(resolve(dir, 'replay.har'), JSON.stringify(har));
      await replayContext.routeFromHAR(resolve(dir, 'replay.har'), { notFound: 'abort' });
      result = await renderPage(await replayContext.newPage(), capture, resolve(dir, name + '.png'));
    } else result = await renderCapture(browser, capture, resolve(dir, name + '.png'));
    await writeFile(resolve(dir, name + '.json'), JSON.stringify(result, null, 2));
    if (!result.text.includes('Unprecedented') || !result.text.includes('Join the Waitlist')) throw new Error('Exact Harvey hero did not become visible');
    console.log(JSON.stringify(result, null, 2));
  } finally { await replayContext?.close(); await browser.close(); }
  process.exit(0);
}
const started = Date.now();
const requests = [], errors = [];
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: USER_AGENT, serviceWorkers: 'block', acceptDownloads: false, recordHar: { path: resolve(dir, 'archive.har'), content: 'embed' } });
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.protocol === 'https:' && url.hostname === 'web.archive.org') return route.continue();
  return route.abort();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => requests.push({ ms: Date.now() - started, status: response.status(), url: response.url() }));
page.on('requestfailed', request => requests.push({ ms: Date.now() - started, failure: request.failure(), url: request.url() }));
const states = [];
async function state(label) {
  const data = await page.evaluate(() => ({ text: document.body.innerText, title: document.title, animations: document.getAnimations().map(a => ({ state: a.playState, time: a.currentTime, timing: a.effect?.getComputedTiming() })), headings: [...document.querySelectorAll('h1,h2')].map(el => ({ text: el.textContent, style: el.getAttribute('style'), opacity: getComputedStyle(el).opacity, rect: el.getBoundingClientRect().toJSON() })), scripts: [...document.scripts].map(s => s.src) }));
  states.push({ label, ms: Date.now() - started, url: page.url(), ...data });
  await page.screenshot({ path: resolve(dir, label + '.png'), timeout: 10000 });
}
try {
  const response = await page.goto(replayUrl('20240218234204', 'https://www.harvey.ai/'), { waitUntil: 'domcontentloaded', timeout: 35000 });
  if (response.status() >= 400) throw new Error(`Archive HTTP ${response.status()}`);
  const navigationMs = Date.now() - started;
  await page.waitForTimeout(2200);
  await state('before-freeze');
  const style = await page.addStyleTag({ content: '#wm-ipp-base, #wm-ipp-print, #donato, .wb-autocomplete-suggestions { display:none!important; } html { scroll-behavior:auto!important; } * { animation:none!important; transition:none!important; }' });
  await page.screenshot({ path: resolve(dir, 'baseline.png'), animations: 'disabled', timeout: 10000 });
  await state('baseline-state');
  await style.evaluate(el => el.remove());
  await page.addStyleTag({ content: '#wm-ipp-base, #wm-ipp-print, #donato, .wb-autocomplete-suggestions { display:none!important; }' });
  await page.waitForTimeout(8000);
  await state('natural');
  await writeFile(resolve(dir, 'baseline.json'), JSON.stringify({ navigationMs, totalMs: Date.now() - started, states, requests, errors }, null, 2));
  console.log(JSON.stringify({ navigationMs, totalMs: Date.now() - started, states: states.map(({label,ms,headings}) => ({label,ms,headings})), errors }, null, 2));
} finally {
  await context.close();
  await browser.close();
}

// Browser lives in a muted Linux Space. Run the host driver through the heavy-job queue.
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { trackReadiness, waitForCaptureReady } from '../renderer.js';
import { keyFor, RENDER_VERSION } from '../lib.js';

const origin = process.env.BENCH_ORIGIN || 'https://visual-wayback-preview-benchmark.moritzw.workers.dev';
const output = process.env.BENCH_OUTPUT || '/Users/m/Documents/visual-wayback/iframe-comparison';
const cases = [
  { id: 'rogo', timestamp: '20260802001057', original: 'https://rogo.ai/' },
  { id: 'harvey', timestamp: '20240102030342', original: 'https://www.harvey.ai/' },
];
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP('http://localhost:19831');
const results = [];
try {
  for (const capture of cases.filter(c => !process.env.BENCH_CASES || process.env.BENCH_CASES.split(',').includes(c.id))) {
    for (const mode of (process.env.BENCH_MODES?.split(',') || ['direct-iframe', 'proxy-iframe', 'server-screenshot', 'cached-screenshot'])) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: false });
      let activity;
      const result = { capture: capture.id, mode };
      try {
        const blocked = [];
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin === 'https://preview-benchmark.invalid') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><style>html,body{margin:0}iframe,img{display:block;border:0;width:1280px;height:800px}</style></head><body></body></html>' });
          if (url.protocol === 'https:' && [new URL(origin).hostname, 'web.archive.org', 'web-static.archive.org', 'visualwayback.com'].includes(url.hostname)) return route.continue();
          blocked.push(url.origin); return route.abort();
        });
        await context.routeWebSocket('**/*', ws => ws.close());
        await context.addInitScript(() => {
          window.__previewPaints = [];
          new PerformanceObserver(list => { for (const e of list.getEntries()) window.__previewPaints.push({ name: e.name, ms: e.startTime }); }).observe({ type: 'paint', buffered: true });
        });
        const page = await context.newPage();
        page.on('dialog', dialog => dialog.dismiss());
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto('https://preview-benchmark.invalid/');
        const start = performance.now();
        if (mode.endsWith('iframe')) {
          activity = trackReadiness(page);
          const src = mode === 'direct-iframe' ? `https://web.archive.org/web/${capture.timestamp}if_/${capture.original}` : `${origin}/proxy?id=${capture.id}`;
          const responseTiming = [];
          page.on('response', async response => {
            if (response.url() === src) responseTiming.push({ status: response.status(), fetchMs: response.headers()['x-archive-fetch-ms'], parseMs: response.headers()['x-text-parse-ms'], textLength: response.headers()['x-text-length'] });
          });
          await page.evaluate(src => { const f = document.createElement('iframe'); f.sandbox = 'allow-scripts allow-same-origin'; f.src = src; document.body.append(f); }, src);
          const frame = await (await page.locator('iframe').elementHandle()).contentFrame();
          await frame.waitForURL(url => url.href !== 'about:blank', { timeout: 20000 });
          await frame.waitForLoadState('domcontentloaded', { timeout: 20000 });
          result.domMs = Math.round(performance.now() - start);
          try { result.readiness = await waitForCaptureReady(frame, activity, { timeoutMs: 15000 }); }
          catch (error) { result.readinessError = error.message; }
          result.readyMs = Math.round(performance.now() - start);
          result.actualUrl = frame.url();
          result.text = await frame.locator('body').innerText({ timeout: 3000 });
          result.title = await frame.title();
          result.paint = await frame.evaluate(() => window.__previewPaints);
          result.parentCanRead = await page.evaluate(() => document.querySelector('iframe').contentDocument !== null);
          result.http = responseTiming;
          if (process.env.BENCH_LINGER_MS) {
            await page.waitForTimeout(Number(process.env.BENCH_LINGER_MS));
            result.lateCheckMs = Math.round(performance.now() - start);
            result.headings = await frame.locator('h1,h2').evaluateAll(nodes => nodes.map(n => ({ text: n.textContent, opacity: getComputedStyle(n).opacity, visibility: getComputedStyle(n).visibility, rect: { width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height } })));
          }
        } else if (mode === 'server-screenshot') {
          Object.assign(result, await page.evaluate(async src => {
            const start = performance.now(), response = await fetch(src);
            if (!response.ok) return { error: await response.text(), status: response.status() };
            const blob = await response.blob(), img = new Image();
            img.src = URL.createObjectURL(blob); document.body.append(img); await img.decode();
            return { readyMs: Math.round(performance.now() - start), bytes: blob.size, renderMs: Number(response.headers.get('x-render-ms')), text: decodeURIComponent(response.headers.get('x-rendered-text') || '') };
          }, `${origin}/shot?id=${capture.id}`));
        } else {
          const key = keyFor(capture.timestamp + capture.original + ':' + RENDER_VERSION);
          Object.assign(result, await page.evaluate(async src => {
            const start = performance.now(), img = new Image(); img.src = src; document.body.append(img); await img.decode();
            return { readyMs: Math.round(performance.now() - start) };
          }, `https://visualwayback.com/cache/${key}.png`));
        }
        await page.screenshot({ path: `${output}/${capture.id}-${mode}.png`, timeout: 5000 });
        result.errors = errors.slice(0, 8); result.blockedOrigins = [...new Set(blocked)];
      } catch (error) { result.error = error.message; }
      finally { activity?.dispose(); await context.close(); }
      results.push(result);
      console.log(JSON.stringify({ ...result, text: result.text ? `[${result.text.length} characters]` : undefined }), '\n');
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    }
    // Read source text after visual timings so this fetch cannot prewarm the proxy trial.
    try {
      const response = await fetch(`${origin}/text?id=${capture.id}`);
      const extracted = await response.json();
      await writeFile(`${output}/${capture.id}-server-text.json`, JSON.stringify(extracted, null, 2));
      console.log(JSON.stringify({ capture: capture.id, mode: 'server-text', fetchMs: extracted.fetchMs, parseMs: extracted.parseMs, textLength: extracted.text?.length, error: extracted.error }));
    } catch (error) { console.log(JSON.stringify({ capture: capture.id, textError: error.message })); }
  }
} finally {
  // Playwright close() on a CDP connection can merely disconnect. This endpoint
  // must belong to a dedicated benchmark profile, never a shared/login browser.
  try { const session = await browser.newBrowserCDPSession(); await session.send('Browser.close'); } catch {}
  await browser.close().catch(() => {});
}

// Uses the HAR recorded by renderer-live.js. Zero upstream traffic; run in the resource queue.
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { isolatedContext, launchRendererBrowser, renderPage, runPool } from '../renderer.js';

const dir = resolve('test-output/harvey-renderer');
const browser = await launchRendererBrowser();
const results = [];
try {
  for (const concurrency of [1, 2]) {
    const started = Date.now();
    const captures = [];
    await runPool([0, 1], concurrency, async index => {
      const context = await isolatedContext(browser);
      try {
        await context.routeFromHAR(resolve(dir, 'replay.har'), { notFound: 'abort' });
        const result = await renderPage(await context.newPage(), { timestamp: '20240218234204', original: 'https://www.harvey.ai/' }, resolve(dir, `pool-${concurrency}-${index}.png`));
        assert.match(result.text, /Unprecedented/);
        assert.equal(result.timing.readiness.timedOut, false);
        captures.push(result.timing.totalMs);
      } finally { await context.close(); }
    });
    results.push({ concurrency, captures, elapsedMs: Date.now() - started, upstreamRequests: 0 });
  }
  await writeFile(resolve(dir, 'throughput.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }

import { access, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fetchCaptures, keyFor, selectCaptures, RENDER_VERSION, writeJsonAtomic } from './lib.js';
import { launchRendererBrowser, renderCapture, runPool } from './renderer.js';

const [url, from, to, countArg] = process.argv.slice(2);
const cache = resolve('.cache');
const emit = data => process.stdout.write(JSON.stringify(data) + '\n');
await mkdir(cache, { recursive: true });
let browser;
try {
  emit({ type: 'status', message: 'Finding archived captures…' });
  const rows = await fetchCaptures(url, from, to, { cacheDir: cache });
  const selected = selectCaptures(rows, Number(countArg));
  emit({ type: 'index', total: rows.indexTotal, capped: rows.indexCapped, monthly: rows.indexCapped, sampled: selected.length, captures: selected, firstTimestamp: rows[0]?.timestamp, lastTimestamp: rows.at(-1)?.timestamp });
  if (!selected.length) throw new Error('No successful captures found for this URL and date range. Try a wider range or the www version.');
  let completed = 0;
  const uncached = [];
  // Publish every cached preview before starting any browser work, even if it is a later date.
  for (const capture of selected) {
    const key = keyFor(capture.timestamp + capture.original + ':' + RENDER_VERSION);
    try {
      const saved = JSON.parse(await readFile(resolve(cache, key + '.json'), 'utf8'));
      if (saved.renderVersion !== RENDER_VERSION || saved.error || !saved.text || saved.image !== `/cache/${key}.png`) throw new Error('Stale preview');
      await access(resolve(cache, key + '.png'));
      emit({ type: 'capture', capture: saved, completed: ++completed, cached: true });
      continue;
    } catch {}
    uncached.push({ capture, key });
  }
  if (uncached.length) {
    try { browser = await launchRendererBrowser(); }
    catch (error) {
      for (const { capture } of uncached) emit({ type: 'capture', capture: { ...capture, error: `Renderer unavailable: ${error.message}` }, completed: ++completed });
      throw error;
    }
  }
  let throttled = false;
  // Two pages at most, each in a fresh isolated context. No burst of dozens of IA replays.
  await runPool(uncached, 2, async ({ capture, key }) => {
    if (throttled) {
      emit({ type: 'capture', capture: { ...capture, error: 'Archive throttled requests. Remaining renders skipped; try again later.' }, completed: ++completed });
      return;
    }
    emit({ type: 'status', message: `Rendering ${capture.timestamp.slice(0, 4)} · ${completed + 1} of ${selected.length}` });
    try {
      const rendered = await renderCapture(browser, capture, resolve(cache, key + '.png'));
      const result = { ...rendered, image: `/cache/${key}.png`, renderVersion: RENDER_VERSION };
      await writeJsonAtomic(resolve(cache, key + '.json'), result);
      emit({ type: 'capture', capture: result, completed: ++completed, cached: false });
    } catch (error) {
      if (/HTTP (429|503)|rate limit/i.test(error.message)) throttled = true;
      emit({ type: 'capture', capture: { ...capture, error: error.message }, completed: ++completed });
    }
  });
  emit({ type: 'done' });
} catch (error) {
  emit({ type: 'error', message: error.message });
  process.exitCode = 1;
} finally {
  await browser?.close();
}

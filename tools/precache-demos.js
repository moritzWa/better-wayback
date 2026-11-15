// Run with node tools/precache-demos.js stripe|amazon [--cached-only].
// Network mode uses the real CDX index and sandboxed archive-only renderer.
// Package only successful captures; keep failures as explicit provenance.
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fetchCaptures, selectCaptures, keyFor, RENDER_VERSION, writeJsonAtomic } from '../lib.js';
import { launchRendererBrowser, renderCapture } from '../renderer.js';

const name = process.argv[2];
if (!['stripe', 'amazon'].includes(name)) throw new Error('Choose stripe or amazon');
const url = name === 'stripe' ? 'https://stripe.com/' : 'https://www.amazon.com/';
const cachedOnly = process.argv.includes('--cached-only');
const cache = resolve('.cache');
await mkdir(cache, { recursive: true });
const captures = [], unavailable = [];
if (cachedOnly) {
  try { unavailable.push(...JSON.parse(await readFile(`demos/${name}-attempts.json`, 'utf8')).unavailable); } catch {}
}
let rows, browser;
try {
  if (cachedOnly) {
    rows = [];
    for (const file of await readdir(cache)) {
      if (!/^[a-f0-9]{24}\.json$/.test(file)) continue;
      const saved = JSON.parse(await readFile(resolve(cache, file), 'utf8'));
      if (saved.original && new URL(saved.original).hostname.replace(/^www\./, '') === `${name}.com` && saved.renderVersion === RENDER_VERSION && saved.image && !saved.error && saved.text && !rows.some(row => row.timestamp === saved.timestamp)) rows.push(saved);
    }
    rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const indexFrom = name === 'stripe' ? '2012' : '';
    try {
      const index = JSON.parse(await readFile(resolve(cache, `cdx-${keyFor(JSON.stringify([url, indexFrom, String(new Date().getFullYear()), 'v1']))}.json`), 'utf8'));
      rows.indexTotal = index.indexTotal;
      rows.indexCapped = index.indexCapped;
    } catch {}
  } else rows = await fetchCaptures(url, '', String(new Date().getFullYear()), { cacheDir: cache });
  const selected = selectCaptures(rows, 8);
  // Retry adjacent real index captures when a selected replay has missing assets.
  // Sequential requests are intentionally conservative (never over two pages).
  for (const capture of selected) {
    const candidates = cachedOnly ? [capture] : [capture, ...rows.filter(row => row !== capture && Math.abs(+row.timestamp.slice(0, 4) - +capture.timestamp.slice(0, 4)) <= 1).sort((a, b) => Math.abs(+a.timestamp - +capture.timestamp) - Math.abs(+b.timestamp - +capture.timestamp)).slice(0, 2)];
    for (const candidate of candidates) {
      if (captures.some(row => row.timestamp === candidate.timestamp)) continue;
      const key = keyFor(candidate.timestamp + candidate.original + ':' + RENDER_VERSION);
      let saved;
      try {
        try {
          saved = JSON.parse(await readFile(resolve(cache, key + '.json'), 'utf8'));
          if (saved.renderVersion !== RENDER_VERSION || saved.error || !saved.text) throw new Error('Stale capture');
          await access(resolve(cache, key + '.png'));
        } catch {
          if (cachedOnly) throw new Error('Cached screenshot unavailable');
          browser ||= await launchRendererBrowser();
          const rendered = await renderCapture(browser, candidate, resolve(cache, key + '.png'));
          saved = { ...rendered, image: `/cache/${key}.png`, renderVersion: RENDER_VERSION };
          await writeJsonAtomic(resolve(cache, key + '.json'), saved);
        }
        if (captures.some(row => row.timestamp === saved.timestamp)) continue;
        const source = resolve(cache, saved.image.split('/').at(-1));
        const png = await readFile(source);
        const sha256 = createHash('sha256').update(png).digest('hex');
        const image = `/demos/${name}/${saved.timestamp}-${sha256.slice(0, 24)}.png`;
        await mkdir(resolve('public/demos', name), { recursive: true });
        await copyFile(source, resolve('public', image.slice(1)));
        // Explicit allowlist avoids leaking local paths, browser state or private metadata.
        const { timestamp, requestedTimestamp, original, digest, title, text, archiveUrl, timing, renderVersion } = saved;
        captures.push({ timestamp, requestedTimestamp, original, digest, title, text, archiveUrl, timing, renderVersion, image, sha256 });
        console.log(JSON.stringify({ name, timestamp, image, timing }));
        break;
      } catch (error) {
        unavailable.push({ timestamp: candidate.timestamp, original: candidate.original, error: error.message });
        console.log(JSON.stringify({ name, ...unavailable.at(-1) }));
        if (/HTTP (429|503)|rate limit/i.test(error.message)) throw error;
      }
    }
  }
} catch (error) {
  // Keep already completed real screenshots, but never retry after a throttle.
  if (!/HTTP (429|503)|rate limit/i.test(error.message)) throw error;
  for (const row of selectCaptures(rows || [], 8)) {
    if (!captures.some(capture => capture.requestedTimestamp === row.timestamp || capture.timestamp === row.timestamp) && !unavailable.some(capture => capture.timestamp === row.timestamp)) unavailable.push({ timestamp: row.timestamp, original: row.original, error: 'Skipped after archive throttled requests.', skipped: true });
  }
} finally {
  await browser?.close();
  await mkdir('demos', { recursive: true });
  await writeFile(`demos/${name}-attempts.json`, JSON.stringify({ url, unavailable }, null, 2));
}
captures.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
if (captures.length < 4) throw new Error(`Only ${captures.length} successful ${name} captures; need at least four. Existing manifest left intact.`);
const firstTimestamp = captures[0].timestamp, lastTimestamp = captures.at(-1).timestamp;
await writeFile(`demos/${name}.json`, JSON.stringify({ url, from: firstTimestamp.slice(0, 4), to: lastTimestamp.slice(0, 4), firstTimestamp, lastTimestamp, count: captures.length, total: rows.indexTotal || rows.length, sampled: captures.length, capped: rows.indexCapped || false, cached: true, status: 'ready', curated: true, source: 'Internet Archive Wayback Machine', captures, unavailable }, null, 2));

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export { cleanText, similarity, groupCaptures } from './group.js';

// Shared by screenshot AND completed-job keys. Old black previews cannot leak through either cache.
export const RENDER_VERSION = 'render-v2-ready';
export const USER_AGENT = 'VisualWayback/0.1 (research prototype; gpt-6.1-sol)';
const captureTime = timestamp => Date.UTC(+timestamp.slice(0, 4), +timestamp.slice(4, 6) - 1, +timestamp.slice(6, 8), +timestamp.slice(8, 10), +timestamp.slice(10, 12), +timestamp.slice(12, 14));
// Sample elapsed time, not row offsets: bursts of captures must not consume the timeline.
export function selectCaptures(rows, count = 8) {
  const sorted = [...rows].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (sorted.length <= count) return sorted;
  if (count <= 1) return sorted.slice(0, 1);
  const first = captureTime(sorted[0].timestamp), span = captureTime(sorted.at(-1).timestamp) - first;
  const chosen = [0];
  for (let i = 1; i < count - 1; i++) {
    const target = first + span * i / (count - 1);
    let best = chosen.at(-1) + 1;
    const end = sorted.length - (count - i);
    for (let j = best + 1; j <= end; j++) if (Math.abs(captureTime(sorted[j].timestamp) - target) < Math.abs(captureTime(sorted[best].timestamp) - target)) best = j;
    chosen.push(best);
  }
  chosen.push(sorted.length - 1);
  return chosen.map(i => sorted[i]);
}
export function normalizeUrl(input) {
  const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password || url.port) throw new Error('Enter a public website URL without credentials or a custom port.');
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) throw new Error('Enter a public website URL.');
  url.hash = '';
  return url.href;
}
export const keyFor = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
export function replayUrl(timestamp, original, raw = false) {
  if (!/^\d{14}$/.test(timestamp)) throw new Error('Invalid capture timestamp');
  return `https://web.archive.org/web/${timestamp}${raw ? 'id_' : ''}/${original}`;
}
export async function writeJsonAtomic(path, data) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(data));
  await rename(temporary, path);
}
export async function fetchCaptures(url, from, to, { cacheDir, maxAgeMs = 86400000 } = {}) {
  const cachePath = cacheDir && resolve(cacheDir, `cdx-${keyFor(JSON.stringify([url, from, to, 'v1']))}.json`);
  if (cachePath) {
    try {
      const saved = JSON.parse(await readFile(cachePath, 'utf8'));
      if (Date.now() - saved.savedAt < maxAgeMs && Array.isArray(saved.rows)) {
        return Object.assign(saved.rows, { indexTotal: saved.indexTotal, indexCapped: saved.indexCapped });
      }
    } catch {}
  }
  const params = new URLSearchParams({ url, output: 'json', filter: 'statuscode:200', collapse: 'digest', fl: 'timestamp,original,digest', limit: '1200' });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const request = async () => {
    const response = await fetch(`https://web.archive.org/cdx/search/cdx?${params}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`Wayback returned ${response.status}. Please try again later.`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Unexpected response from Wayback.');
    return data.slice(1).filter(row => /^\d{14}$/.test(row[0]) && /^https?:\/\//.test(row[1])).map(([timestamp, original, digest]) => ({ timestamp, original, digest }));
  };
  let rows = await request();
  const total = rows.length, capped = total === 1200;
  if (capped) {
    // A dense site's first 1,200 captures may cover only its early years.
    // One candidate per month covers the requested span without huge queries.
    params.set('collapse', 'timestamp:6');
    rows = await request();
  }
  rows.indexTotal = total;
  rows.indexCapped = capped;
  if (cachePath) {
    await mkdir(cacheDir, { recursive: true });
    await writeJsonAtomic(cachePath, { savedAt: Date.now(), rows, indexTotal: total, indexCapped: capped });
  }
  return rows;
}

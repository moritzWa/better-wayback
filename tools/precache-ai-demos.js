// Genuine Wayback captures only. Drive a dedicated muted Linux Space via CDP.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { renderCapture } from '../renderer.js';
import { keyFor, RENDER_VERSION, isArchiveErrorPage, USER_AGENT } from '../lib.js';

const definitions = [
  { name: 'openai', url: 'https://openai.com/', years: ['2016', '2019', '2022', '2023', '2024', '2025'] },
  { name: 'anthropic', url: 'https://www.anthropic.com/', years: ['2021', '2022', '2023', '2025'] },
  { name: 'nvidia', url: 'https://www.nvidia.com/', years: ['1999', '2007', '2012', '2013', '2016', '2025'] },
].filter(d => !process.env.AI_DEMO_NAME || process.env.AI_DEMO_NAME.split(',').includes(d.name));
const directory = process.env.AI_DEMO_CANDIDATES_DIR || '.cache/ai-demo-candidates';
await mkdir('.cache', { recursive: true });
const browser = await chromium.connectOverCDP(process.env.AI_DEMO_CDP || 'http://localhost:19832');
let throttled = false;
const invalid = result => isArchiveErrorPage(result.title, result.text) || /pardon our interruption|robot check|security verification|page not found/i.test(result.title + '\n' + result.text.slice(0, 500));
async function loadCandidates(definition) {
  const path = resolve(directory, definition.name + '-candidates.json');
  try { return JSON.parse(await readFile(path, 'utf8')); } catch {}
  const rows = [];
  for (const year of definition.years) {
    if (throttled) break;
    const url = definition.name === 'nvidia' ? `https://www.nvidia.com/${+year >= 2020 ? 'en-us/' : +year >= 2000 ? 'page/home.html' : ''}` : definition.url;
    const params = new URLSearchParams({ url, output: 'json', filter: 'statuscode:200', collapse: 'timestamp:6', fl: 'timestamp,original,digest', from: year, to: year, limit: '2' });
    const response = await fetch(`https://web.archive.org/cdx/search/cdx?${params}`, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) { if ([429, 503].includes(response.status)) throttled = true; throw new Error(`Archive index returned HTTP ${response.status}`); }
    const data = await response.json();
    rows.push(...data.slice(1).map(([timestamp, original, digest]) => ({ timestamp, original, digest })));
  }
  await mkdir(directory, { recursive: true }); await writeFile(path, JSON.stringify(rows, null, 2));
  return rows;
}
try {
  for (const definition of definitions) {
    const rows = await loadCandidates(definition);
    let previous;
    try { previous = JSON.parse(await readFile(`demos/${definition.name}.json`, 'utf8')); } catch {}
    const captures = (previous?.captures || []).filter(c => !invalid(c));
    const unavailable = [...(previous?.unavailable || []), ...(previous?.captures || []).filter(invalid).map(c => ({ timestamp: c.timestamp, original: c.original, error: 'Rejected an archived client-side error/interstitial, not a usable website preview.' }))];
    try { for (const failure of JSON.parse(await readFile(`demos/${definition.name}-attempts.json`, 'utf8')).unavailable) if (!unavailable.some(c => c.timestamp === failure.timestamp)) unavailable.push(failure); } catch {}
    for (const year of definition.years) {
      if (captures.some(c => c.timestamp.startsWith(year))) continue;
      for (const candidate of rows.filter(c => c.timestamp.startsWith(year)).slice(0, 2)) {
        if (!process.argv.includes('--retry') && unavailable.some(c => c.timestamp === candidate.timestamp)) continue;
        if (throttled) { unavailable.push({ ...candidate, error: 'Skipped after archive throttling.', skipped: true }); continue; }
        const key = keyFor(candidate.timestamp + candidate.original + ':' + RENDER_VERSION);
        try {
          let result;
          try {
            result = JSON.parse(await readFile(resolve('.cache', key + '.json'), 'utf8'));
            if (result.renderVersion !== RENDER_VERSION || result.error || invalid(result)) throw new Error('Invalid cached capture');
            await readFile(resolve('.cache', key + '.png'));
          } catch { result = await renderCapture(browser, candidate, resolve('.cache', key + '.png'), { readinessTimeoutMs: 18000 }); }
          if (invalid(result)) throw new Error('Archive replay is an error/interstitial page, not a usable website capture.');
          if (captures.some(c => c.timestamp === result.timestamp)) continue;
          const png = await readFile(resolve('.cache', key + '.png'));
          const sha256 = createHash('sha256').update(png).digest('hex');
          const image = `/demos/${definition.name}/${result.timestamp}-${sha256.slice(0, 24)}.png`;
          await mkdir(resolve('public/demos', definition.name), { recursive: true });
          await copyFile(resolve('.cache', key + '.png'), resolve('public', image.slice(1)));
          const saved = { ...result, image, sha256, renderVersion: RENDER_VERSION };
          captures.push(saved);
          await writeFile(resolve('.cache', key + '.json'), JSON.stringify({ ...result, image: `/cache/${key}.png`, renderVersion: RENDER_VERSION }));
          console.log(JSON.stringify({ name: definition.name, timestamp: result.timestamp, title: result.title, image, timing: result.timing }), '\n');
          break;
        } catch (error) {
          unavailable.push({ ...candidate, error: error.message });
          console.log(JSON.stringify({ name: definition.name, timestamp: candidate.timestamp, error: error.message }));
          if (/HTTP (429|503)|rate limit/i.test(error.message)) throttled = true;
        }
      }
    }
    await writeFile(`demos/${definition.name}-attempts.json`, JSON.stringify({ url: definition.url, unavailable }, null, 2));
    if (captures.length < 3) { console.log(JSON.stringify({ name: definition.name, error: `Only ${captures.length} usable captures; no manifest published.` })); process.exitCode = 1; continue; }
    captures.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const firstTimestamp = captures[0].timestamp, lastTimestamp = captures.at(-1).timestamp;
    await writeFile(`demos/${definition.name}.json`, JSON.stringify({ url: definition.url, from: firstTimestamp.slice(0, 4), to: lastTimestamp.slice(0, 4), firstTimestamp, lastTimestamp, count: captures.length, total: rows.length, sampled: captures.length, capped: false, cached: true, status: 'ready', curated: true, source: 'Internet Archive Wayback Machine', indexNote: 'Curated from year-specific CDX queries and historical homepage paths, not the complete capture index.', captures, unavailable }, null, 2));
  }
} finally {
  // Keep this task's dedicated capture browser for the subsequent demo recording.
  await browser.close();
}

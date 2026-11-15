import { articles } from './articles.js';

// Finite GET check of documentation links only. Never submit a capture or form.
const urls = new Set();
for (const article of articles) {
  for (const source of article.sources) urls.add(source.url);
  for (const block of article.blocks) {
    for (const [, url] of String(block.text || '').matchAll(/\]\((https:\/\/[^\s)]+)\)/g)) urls.add(url);
  }
}
let failures = 0;
const pending = [...urls];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (pending.length) {
    const url = pending.shift();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow', headers: { 'User-Agent': 'VisualWayback-EditorialLinkCheck/1.0' } });
      console.log(`${response.status} ${url}${response.url !== url ? ` -> ${response.url}` : ''}`);
      await response.body?.cancel();
      if (!response.ok) failures++;
    } catch (error) {
      failures++;
      console.log(`ERROR ${url}: ${error.message}`);
    }
  }
}));
console.log(`Checked ${urls.size} unique external URLs; ${failures} require review.`);
process.exitCode = failures ? 1 : 0;

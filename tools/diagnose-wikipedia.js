import { mkdir, writeFile } from 'node:fs/promises';
import { launchRendererBrowser, isolatedContext, renderPage } from '../renderer.js';

const phase = process.argv.includes('--after') ? 'wikipedia-after' : 'wikipedia';
await mkdir(`test-output/${phase}`, { recursive: true });
const browser = await launchRendererBrowser();
try {
  for (const timestamp of ['20261101003100', '20120102032616']) {
    const context = await isolatedContext(browser);
    const page = await context.newPage();
    let error, result;
    try { result = await renderPage(page, { timestamp, original: 'https://www.wikipedia.org/' }, `test-output/${phase}/${timestamp}.png`); }
    catch (e) { error = e.message; }
    const state = await page.evaluate(() => ({ url: location.href, title: document.title, textLength: document.body?.innerText.length, headings: [...document.querySelectorAll('h1,h2,[role="heading"]')].map(el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return { text: el.textContent.trim().slice(0, 120), visibility: s.visibility, opacity: s.opacity, display: s.display, position: s.position, clip: s.clip, rect: { x: r.x, y: r.y, width: r.width, height: r.height } }; }) }));
    await writeFile(`test-output/${phase}/${timestamp}.json`, JSON.stringify({ timestamp, error, timing: result?.timing, state }, null, 2));
    console.log(JSON.stringify({ timestamp, error, timing: result?.timing, state }));
    await context.close();
    if (/429|503|rate limit/i.test(error || '')) break;
  }
} finally { await browser.close(); }

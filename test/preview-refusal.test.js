// Deterministic fixture for Archive refusing document requests (Chrome shows a sad page and fires load within milliseconds).
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true });
try {
  const js = await readFile('public/previews.js', 'utf8');
  const css = await readFile('public/previews.css', 'utf8');
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.addInitScript(() => { window.refusedLoadMs = 150; });
  await page.route('https://fixture.invalid/**', route => route.request().url().endsWith('previews.js')
    ? route.fulfill({ contentType: 'text/javascript', body: js })
    : route.fulfill({ contentType: 'text/html', body: `<style>${css}body{margin:0}.live-preview{width:800px}</style><main></main><script type="module">import * as api from '/previews.js';window.api=api;window.make=n=>{const w=api.livePreview({previewUrl:'https://web.archive.org/web/'+(2000+n)+'0101000000if_/https://example.invalid/'},'Fixture '+n);w.id='p'+n;document.querySelector('main').append(w);return w};window.ready=true;</script>` }));
  let refuse = 1, requests = 0;
  await page.route('https://web.archive.org/**', async route => {
    requests++;
    if (refuse > 0) { refuse--; return route.fulfill({ contentType: 'text/html', body: '<p>refused</p>' }); }
    await new Promise(resolve => setTimeout(resolve, 400));
    await route.fulfill({ contentType: 'text/html', body: '<p>Real archive document</p>' }).catch(() => {});
  });
  await page.goto('https://fixture.invalid/');
  await page.waitForFunction(() => window.ready);

  await page.evaluate(() => { window.make(1); api.refreshPreviews(); });
  await page.waitForFunction(() => document.querySelector('#p1 .live-status')?.textContent.includes('busy'), null, { timeout: 5000 });
  assert.equal(await page.locator('#p1 iframe').count(), 0, 'refused frame is removed instead of left as a sad page');
  await page.waitForFunction(() => document.querySelector('#p1').dataset.previewState === 'ready', null, { timeout: 15000 });
  assert.equal(requests, 2, 'one refusal retried once');

  refuse = 99; requests = 0;
  await page.evaluate(() => { api.resetPreviews(); document.querySelector('main').replaceChildren(); window.make(2); api.refreshPreviews(); });
  await page.waitForFunction(() => document.querySelector('#p2').dataset.previewState === 'error', null, { timeout: 30000 });
  assert.equal(requests, 3, 'bounded to three attempts');
  assert.equal(await page.locator('#p2 .preview-retry-button').isVisible(), true);
  refuse = 0;
  await page.locator('#p2 .preview-retry-button').click();
  await page.waitForFunction(() => document.querySelector('#p2').dataset.previewState === 'ready', null, { timeout: 15000 });
  console.log('PASS refused archive documents back off, retry, then offer an explicit retry');
} finally { await browser.close(); }

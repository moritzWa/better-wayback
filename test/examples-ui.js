import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { examples } from '../public/examples.js';
import { loadDemo } from '../demos.js';

const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser;
const deadline = setTimeout(() => { server.kill('SIGTERM'); process.exitCode = 1; }, 60000);
try {
  const [output] = await once(server.stdout, 'data');
  const base = process.env.EXAMPLES_TEST_BASE || String(output).match(/http:\/\/localhost:\d+/)[0];
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let jobs = 0;
  await page.addInitScript(() => { window.EventSource = class { constructor() {} close() {} }; });
  await page.route('**/api/jobs', route => { jobs++; return route.fulfill({ json: { id: 'fixture', url: 'https://example.invalid/' } }); });
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
  for (const example of examples) {
    const expected = await loadDemo(example.id);
    await page.locator(`[data-site="${example.host}"]`).click();
    await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
    assert.equal(new URL(page.url()).searchParams.get('url'), example.host);
    assert.match(await page.locator('#stats').innerText(), new RegExp(`${expected.captures.length}/${expected.captures.length} sampled`));
    assert.ok((await page.locator('#site-title').innerText()).endsWith(example.host));
    await page.locator('#all-view').click();
    assert.equal(await page.locator('#timeline img').count(), expected.captures.length);
    await page.locator('#timeline img').evaluateAll(images => Promise.all(images.map(img => { img.loading = 'eager'; return img.decode(); })));
    assert.equal(await page.locator('.live-frame').count(), 0);
    if(expected.captures.some(c=>c.sourceType==='live')){
      const current=page.locator('.timeline-entry').last();
      assert.equal(await current.locator('.entry-date').innerText(),'Current');
      assert.match(await current.locator('.entry-badge').innerText(),/NOT AN ARCHIVE REPLAY/);
      assert.equal(await current.getByRole('link',{name:'Open current site ↗',exact:true}).getAttribute('href'),'https://www.apple.com/');
      assert.equal(await current.locator('.compare-button').isVisible(),false);
      assert.match(await current.locator('img').getAttribute('alt'),/live site captured/);
      assert.match(await page.locator('#sampling-note').innerText(),/not an Internet Archive replay/);
    }
    assert.doesNotMatch(await page.locator('#sampling-note').textContent(), /A sampled history|Dates show when|New previews load|A selection of archived previews/);
    assert.equal(jobs, 0);
  }
  await page.locator('#settings').evaluate(n => { n.open = true; });
  await page.locator('#from').fill('2020');
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/jobs')), page.locator('#search-form').evaluate(n => n.requestSubmit())]);
  await page.waitForFunction(() => document.querySelector('#search-button').disabled);
  assert.equal(jobs, 1, 'custom date ranges must use live archive lookup');
  await page.locator('[data-site="openai.com"]').click();
  await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
  assert.equal(await page.locator('#from').inputValue(), '');
  assert.equal(await page.locator('#count').inputValue(), '8');
  console.log(`PASS: all ${examples.length} real packaged examples, decoded PNGs, query URLs, zero archive jobs for presets and live lookup for custom dates.`);
} finally {
  clearTimeout(deadline); await browser?.close(); server.kill('SIGTERM');
  if (server.exitCode == null) await once(server, 'exit');
}

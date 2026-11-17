import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser;
const deadline = setTimeout(() => { server.kill('SIGTERM'); process.exitCode = 1; }, 60000);
try {
  const [output] = await once(server.stdout, 'data');
  const base = process.env.SEARCH_URL_TEST_BASE || String(output).match(/http:\/\/localhost:\d+/)[0];
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let requests = [];
  await page.addInitScript(() => {
    window.testStreams = [];
    window.EventSource = class {
      constructor(url) { this.url = url; window.testStreams.push(this); }
      close() { this.closed = true; }
    };
  });
  await page.route('**/api/jobs', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { id: 'a'.repeat(24), url: 'https://rogo.ai/' } });
  });
  await page.goto(base);
  await page.locator('#search-button').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
  await page.locator('#url').fill('rogo.ai');
  assert.equal(requests.length, 0, 'typing alone must not request archive renders');
  await page.locator('details').first().evaluate(n => { n.open = true; });
  await page.locator('#from').fill('2020');
  await page.locator('#to').fill('2024');
  await page.locator('#count').selectOption('16');
  await page.locator('#search-button').click();
  await page.waitForFunction(() => window.testStreams.length === 1);
  let url = new URL(page.url());
  assert.equal(url.searchParams.get('url'), 'rogo.ai');
  assert.equal(url.searchParams.get('from'), '2020');
  assert.equal(url.searchParams.get('to'), '2024');
  assert.equal(url.searchParams.get('count'), '16');
  await page.reload();
  await page.waitForFunction(() => window.testStreams.length === 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.at(-1), { url: 'rogo.ai', from: '2020', to: '2024', count: '16', previewMode: 'html' });
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#url').value === 'stripe.com' && !document.querySelector('#search-button').disabled);
  assert.equal(new URL(page.url()).search, '');
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('#url').value === 'rogo.ai' && window.testStreams.length >= 2);
  assert.equal(await page.locator('#count').inputValue(), '16');
  await page.locator('[data-site="amazon.com"]').click();
  await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
  url = new URL(page.url());
  assert.equal(url.searchParams.get('url'), 'amazon.com');
  assert.equal(url.searchParams.has('count'), false);
  assert.equal(url.searchParams.has('from'), false);
  assert.equal(await page.locator('#count').inputValue(), '8');
  console.log('PASS: shareable search URL, settings, reload, Back/Forward, preset cancellation and no per-keystroke archive requests');
} finally {
  clearTimeout(deadline);
  await browser?.close();
  server.kill('SIGTERM');
  if (server.exitCode == null) await once(server, 'exit');
}

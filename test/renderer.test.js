import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { archiveRequestAllowed, isolatedContext, runPool, trackReadiness, waitForCaptureReady } from '../renderer.js';
import { fetchCaptures, keyFor, RENDER_VERSION } from '../lib.js';

test('archive-only policy blocks live, local, credentials, ports and WebSockets', () => {
  assert.equal(archiveRequestAllowed('https://web.archive.org/web/20240218234204/https://www.harvey.ai/'), true);
  for (const url of ['http://web.archive.org/', 'https://www.harvey.ai/', 'https://127.0.0.1/', 'https://web.archive.org.evil.test/', 'wss://web.archive.org/', 'https://user:pass@web.archive.org/', 'https://web.archive.org:8443/']) assert.equal(archiveRequestAllowed(url), false, url);
});

test('pool caps at two in-flight renders without losing completion events', async () => {
  let active = 0, peak = 0;
  const completed = [];
  await runPool([1, 2, 3, 4, 5], 2, async item => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, item === 1 ? 20 : 2));
    completed.push(item); active--;
  });
  assert.equal(peak, 2);
  assert.deepEqual(completed.sort(), [1, 2, 3, 4, 5]);
});

test('CDX cache preserves metadata, expires and never caches upstream failures', async () => {
  const cacheDir = await mkdtemp(resolve(tmpdir(), 'wayback-cdx-'));
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return { ok: true, json: async () => [['timestamp', 'original', 'digest'], ['20240218234204', 'https://www.harvey.ai/', 'ABC']] }; };
  try {
    const first = await fetchCaptures('https://www.harvey.ai/', '2024', '2024', { cacheDir });
    const second = await fetchCaptures('https://www.harvey.ai/', '2024', '2024', { cacheDir });
    assert.deepEqual(second, first); assert.equal(requests, 1);
    globalThis.fetch = async () => { requests++; return { ok: false, status: 429 }; };
    await assert.rejects(fetchCaptures('https://www.harvey.ai/', '2024', '2024', { cacheDir, maxAgeMs: 0 }), /429/);
    assert.deepEqual(await fetchCaptures('https://www.harvey.ai/', '2024', '2024', { cacheDir }), first);
  } finally { globalThis.fetch = originalFetch; await rm(cacheDir, { recursive: true }); }
});

test('fully cached worker publishes previews without launching a browser or requesting CDX', async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'wayback-worker-'));
  const cache = resolve(cwd, '.cache');
  const url = 'https://www.harvey.ai/';
  const capture = { timestamp: '20240218234204', original: url, digest: 'ABC' };
  const key = keyFor(capture.timestamp + capture.original + ':' + RENDER_VERSION);
  assert.notEqual(key, keyFor(capture.timestamp + capture.original + ':render-v1'), 'old screenshot key is invalidated');
  try {
    await mkdir(cache);
    await writeFile(resolve(cache, `cdx-${keyFor(JSON.stringify([url, '2024', '2024', 'v1']))}.json`), JSON.stringify({ savedAt: Date.now(), rows: [capture], indexTotal: 1, indexCapped: false }));
    await writeFile(resolve(cache, key + '.json'), JSON.stringify({ ...capture, text: 'Saved visible archived hero', image: `/cache/${key}.png`, renderVersion: RENDER_VERSION }));
    await writeFile(resolve(cache, key + '.png'), 'fixture');
    const { stdout } = await promisify(execFile)(process.execPath, [resolve('worker.js'), url, '2024', '2024', '8'], { cwd, timeout: 10000, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '/nonexistent-browser-proves-no-launch' } });
    const events = stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events.find(e => e.type === 'index').captures, [capture]);
    assert.equal(events.find(e => e.type === 'capture').cached, true);
    assert.equal(events.at(-1).type, 'done');
    // The uncached earlier date must not hold a later cached preview hostage.
    await writeFile(resolve(cache, `cdx-${keyFor(JSON.stringify([url, '2024', '2024', 'v1']))}.json`), JSON.stringify({ savedAt: Date.now(), rows: [{ ...capture, timestamp: '20240101000000' }, capture], indexTotal: 2, indexCapped: false }));
    let mixed;
    try {
      await promisify(execFile)(process.execPath, [resolve('worker.js'), url, '2024', '2024', '8'], { cwd, timeout: 10000, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '/nonexistent-browser-proves-no-launch' } });
      assert.fail('missing browser must stop uncached rendering');
    } catch (error) { mixed = error.stdout.trim().split('\n').map(line => JSON.parse(line)); }
    assert.equal(mixed.find(e => e.type === 'capture').capture.timestamp, capture.timestamp);
    assert.equal(mixed.find(e => e.type === 'capture').cached, true);
    assert.equal(mixed.at(-1).type, 'error');
  } finally { await rm(cwd, { recursive: true }); }
});

// Run browser tests only when explicitly queued by the caller.
test('readiness waits for delayed reveals, ignores infinite decoration, rejects hidden heroes', { skip: process.env.RENDERER_BROWSER_TESTS !== '1' }, async () => {
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  try {
    const context = await isolatedContext(browser);
    const page = await context.newPage();
    const activity = trackReadiness(page);
    await page.setContent(`<style>@keyframes reveal {from {opacity:0} to {opacity:1}} @keyframes spin {to {transform:rotate(360deg)}} h1 {opacity:0;animation:reveal 1s .3s forwards} i {display:block;width:10px;height:10px;animation:spin 1s infinite}</style><h1>Unprecedented Legal AI</h1><p>Actual archived hero text must become visible before we save this screenshot.</p><i></i>`);
    const result = await waitForCaptureReady(page, activity, { timeoutMs: 4000 });
    assert.ok(result.waitMs >= 1100); assert.ok(result.waitMs < 3000);
    assert.equal(result.timedOut, false);
    assert.ok((await page.locator('h1').evaluate(el => Number(getComputedStyle(el).opacity))) > .99);
    await page.addStyleTag({ content: '* { animation:none!important; transition:none!important; }' });
    assert.equal(await page.locator('h1').evaluate(el => getComputedStyle(el).opacity), '0', 'old blanket freeze restores invisible base style');
    await assert.rejects(waitForCaptureReady(page, activity, { timeoutMs: 800 }), /deadline/);
    await page.setContent('<h1 style="opacity:.1">JavaScript-driven hero reveal</h1><p>Another actual heading and enough visible text for an archived page screenshot.</p>');
    await page.evaluate(() => {
      const start = performance.now();
      function tick(now) {
        document.querySelector('h1').style.opacity = String(Math.min(1, .1 + (now - start) / 1500));
        if (now - start < 1500) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    const jsReveal = await waitForCaptureReady(page, activity, { timeoutMs: 4000 });
    assert.ok(jsReveal.waitMs > 1700, 'must wait for inline-style reveal to finish, not just text visibility');
    assert.equal(await page.locator('h1').evaluate(el => getComputedStyle(el).opacity), '1');
    activity.dispose();
    await context.close();
  } finally { await browser.close(); }
});

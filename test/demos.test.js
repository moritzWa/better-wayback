import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { demoNames, loadDemo, demoAsset } from '../demos.js';
import { examples, exampleForSite } from '../public/examples.js';

test('packaged demos contain only genuine successful, integrity-checked archive screenshots', async () => {
  for (const name of demoNames) {
    const demo = await loadDemo(name);
    assert.equal(demo.status, 'ready');
    assert.ok(demo.captures.length >= (['stripe', 'amazon'].includes(name) ? 4 : 3));
    assert.equal(demo.firstTimestamp, demo.captures[0].timestamp);
    assert.equal(demo.lastTimestamp, demo.captures.at(-1).timestamp);
    const minimumSpan = { stripe: 8, amazon: 8, openai: 6, anthropic: 2, nvidia: 15, apple: 12 }[name];
    assert.ok(+demo.to - +demo.from >= minimumSpan, 'history must span meaningful years for this company');
    assert.equal(demo.count, demo.captures.length);
    const seen = new Set();
    for (const capture of demo.captures) {
      assert.equal(capture.error, undefined);
      assert.doesNotMatch(capture.title + '\n' + capture.text.slice(0, 300), /^404(?:\s|$)|application error:|client-side exception has occurred|just a moment/i);
      assert.ok(capture.text.length > 60);
      assert.match(capture.archiveUrl, new RegExp(`/web/${capture.timestamp}/`));
      assert.equal(new URL(capture.original).hostname.replace(/^www\./, ''), `${name}.com`);
      assert.ok(!seen.has(capture.timestamp)); seen.add(capture.timestamp);
      const png = await demoAsset(capture.image);
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(png.readUInt32BE(16), 1280); assert.equal(png.readUInt32BE(20), 800);
      assert.equal(createHash('sha256').update(png).digest('hex'), capture.sha256);
    }
  }
  assert.equal(await loadDemo('wikipedia'), null);
  assert.equal(await demoAsset('/demos/stripe/../../package.json'), null);
  assert.equal(await demoAsset('/demos/stripe/20000101000000-aaaaaaaaaaaaaaaaaaaaaaaa.png'), null);
});

test('all advertised examples have safe matching homepage presets and reject custom paths', () => {
  for (const example of examples) {
    assert.equal(exampleForSite(example.host)?.id, example.id);
    assert.equal(exampleForSite(`https://www.${example.host}/`)?.id, example.id);
    for (const input of [`https://${example.host}/pricing`, `https://${example.host}/?q=test`, `https://name@${example.host}/`, `https://${example.host}:444/`]) assert.equal(exampleForSite(input), null);
  }
  assert.equal(exampleForSite('https://wikipedia.org/'), null);
});

test('demo API and every PNG work instantly with network and browser processes forbidden', async () => {
  const temp = await mkdtemp(resolve(tmpdir(), 'wayback-demo-'));
  let child;
  try {
    const preload = resolve(temp, 'offline.mjs');
    await writeFile(preload, `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; globalThis.fetch=()=>{throw Error('External network forbidden')}; cp.spawn=()=>{throw Error('Browser/worker forbidden')}; syncBuiltinESMExports();`);
    child = spawn(process.execPath, ['--import', preload, resolve('server.js')], { env: { ...process.env, PORT: '0', PLAYWRIGHT_BROWSERS_PATH: '/no-browser' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup deadline')), 5000);
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.stdout.on('data', chunk => { const port = String(chunk).match(/localhost:(\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } });
    });
    for (const name of demoNames) {
      const start = performance.now();
      const response = await fetch(`${base}/api/demos/${name}`);
      assert.equal(response.status, 200);
      const demo = await response.json();
      const apiMs = performance.now() - start;
      let bytes = 0;
      for (const capture of demo.captures) {
        const asset = await fetch(base + capture.image);
        assert.equal(asset.status, 200);
        assert.equal(asset.headers.get('content-type'), 'image/png');
        bytes += (await asset.arrayBuffer()).byteLength;
      }
      const allMs = performance.now() - start;
      console.log(JSON.stringify({ name, captures: demo.captures.length, apiMs: Math.round(apiMs * 100) / 100, allPngMs: Math.round(allMs * 100) / 100, bytes, externalRequests: 0, workers: 0 }));
      assert.ok(apiMs < 1000, 'packaged response must be local disk only');
      assert.ok(allMs < 2000);
    }
    for (const path of ['/api/demos/wikipedia', '/demos/stripe/manifest.json', '/demos/amazon/20000101000000-aaaaaaaaaaaaaaaaaaaaaaaa.png']) assert.equal((await fetch(base + path)).status, 404);
  } finally {
    if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await exit; clearTimeout(timer); }
    await rm(temp, { recursive: true });
  }
});

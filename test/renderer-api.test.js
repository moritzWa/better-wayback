import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { keyFor, RENDER_VERSION } from '../lib.js';

test('alternate ephemeral server uses versioned completed-job cache and rejects bad inputs', async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'wayback-api-'));
  const url = 'https://www.harvey.ai/';
  const id = keyFor(JSON.stringify([url, '2024', '2024', 8, RENDER_VERSION]));
  const oldId = keyFor(JSON.stringify([url, '2024', '2024', 8, 'v2']));
  assert.notEqual(id, oldId, 'bad completed-job cache must not survive renderer upgrade');
  let child;
  try {
    await mkdir(resolve(cwd, '.cache'));
    const events = [{ type: 'index', sampled: 1 }, { type: 'capture', capture: { timestamp: '20240218234204', text: 'Fixed cache' }, completed: 1 }, { type: 'done' }];
    await writeFile(resolve(cwd, `.cache/job-${id}.json`), JSON.stringify({ events }));
    await writeFile(resolve(cwd, `.cache/job-${oldId}.json`), JSON.stringify({ events: [{ type: 'error', message: 'Old black screenshot cache' }] }));
    child = spawn(process.execPath, [resolve('server.js')], { cwd, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test server startup deadline')), 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stdout.on('data', chunk => {
        const port = String(chunk).match(/localhost:(\d+)/)?.[1];
        if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); }
      });
    });
    const post = (body, headers = {}) => fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const response = await post({ url, from: '2024', to: '2024', count: 8 });
    assert.equal(response.status, 200); assert.equal((await response.json()).id, id);
    const stream = await (await fetch(`${base}/api/jobs/${id}/events`)).text();
    assert.match(stream, /Fixed cache/); assert.doesNotMatch(stream, /Old black/);
    assert.equal((await post({ url: '127.0.0.1' })).status, 400);
    assert.equal((await post({ url }, { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await fetch(`${base}/cache/package.json`)).status, 404);
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
      await once(child, 'exit'); clearTimeout(kill);
    }
    await rm(cwd, { recursive: true });
  }
});

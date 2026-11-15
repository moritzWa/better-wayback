import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { keyFor, RENDER_VERSION } from '../lib.js';

for (const guarded of [false, true]) test(`worker ${guarded ? 'automatically uses available local queue' : 'runs portably without personal queue scripts'}`, async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'wayback-portable-'));
  let child;
  try {
    await mkdir(resolve(cwd, '.cache'));
    await writeFile(resolve(cwd, 'worker.js'), `console.log(JSON.stringify({type:'status',message:'direct worker started'})); console.log(JSON.stringify({type:'done'}));`);
    if (guarded) {
      await mkdir(resolve(cwd, '.claude/scripts'), { recursive: true });
      await writeFile(resolve(cwd, '.claude/scripts/heavy-job.py'), `import sys,subprocess,json\nassert sys.argv[1:3] == ['--wait','--']\nprint(json.dumps({'type':'status','message':'local queue invoked'}),flush=True)\nsys.exit(subprocess.call(sys.argv[3:]))\n`);
    }
    child = spawn(process.execPath, [resolve('server.js')], { cwd, env: { ...process.env, HOME: cwd, PORT: '0', BETTER_WAYBACK_NO_QUEUE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup deadline')), 5000);
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.stdout.on('data', chunk => { const port = String(chunk).match(/localhost:(\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } });
    });
    const response = await fetch(base + '/api/jobs', { method: 'POST', body: JSON.stringify({ url: 'https://example.com/', from: '', to: '2026', count: 8 }) });
    assert.equal(response.status, 202);
    const { id } = await response.json();
    assert.equal(id, keyFor(JSON.stringify(['https://example.com/', '', '2026', 8, RENDER_VERSION])));
    const stream = await (await fetch(`${base}/api/jobs/${id}/events`)).text();
    assert.match(stream, /direct worker started/);
    assert.match(stream, /"type":"done"/);
    assert.equal(stream.includes('local queue invoked'), guarded);
  } finally {
    if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await exit; clearTimeout(timer); }
    await rm(cwd, { recursive: true });
  }
});

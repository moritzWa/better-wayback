import http from 'node:http';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { normalizeUrl, keyFor, RENDER_VERSION } from './lib.js';
import { handleBlogRequest, blogScriptHashes } from './blog.js';
import { loadDemo, demoAsset, demoNames } from './demos.js';
import { handleSupportRequest } from './support.mjs';

// Bounded, expiring development-only substitute for Cloudflare CACHE.
const supportRates = new Map();
const supportCache = {
  async get(key) {
    const value = supportRates.get(key);
    return value && value.expires > Date.now() ? value.value : null;
  },
  async put(key, value, { expirationTtl }) {
    for (const [id, entry] of supportRates) if (entry.expires <= Date.now()) supportRates.delete(id);
    if (supportRates.size >= 1000 && !supportRates.has(key)) throw new Error('Rate store full');
    supportRates.set(key, { value, expires: Date.now() + expirationTtl * 1000 });
  },
};

const root = resolve('.');
const port = Number(process.env.PORT || 4317);
const jobs = new Map();
const children = new Set();
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (path.startsWith('/api/support/')) {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
      headers.set('CF-Connecting-IP', req.socket.remoteAddress || 'local');
      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method, headers,
        ...(!['GET', 'HEAD'].includes(req.method) ? { body: req, duplex: 'half' } : {}),
      });
      const support = await handleSupportRequest(request, { ...process.env, CACHE: supportCache });
      if (support) { res.writeHead(support.status, Object.fromEntries(support.headers)); return res.end(Buffer.from(await support.arrayBuffer())); }
    }
    if (['GET', 'HEAD'].includes(req.method) && /^\/api\/demos\/[a-z]+$/.test(path) && demoNames.includes(path.split('/').at(-1))) {
      const demo = await loadDemo(path.split('/').at(-1), root);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(demo));
    }
    if (['GET', 'HEAD'].includes(req.method) && path.startsWith('/demos/')) {
      const asset = await demoAsset(path, root);
      if (!asset) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' });
      return res.end(req.method === 'HEAD' ? undefined : asset);
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const blog = handleBlogRequest(path);
      if (blog) {
        res.writeHead(blog.status, {
          'Content-Type': blog.contentType,
          'Content-Security-Policy': `default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self' https://challenges.cloudflare.com ${blogScriptHashes.join(' ')}; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
        });
        res.end(req.method === 'HEAD' ? undefined : blog.body);
        return;
      }
    }
    if (req.method === 'POST' && path === '/api/jobs') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-origin requests are not allowed.' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4096) return json(res, 413, { error: 'Request too large' }); }
      let input;
      try { input = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
      let url;
      try { url = normalizeUrl(String(input.url || '')); } catch (e) { return json(res, 400, { error: e.message }); }
      const from = String(input.from || ''), to = String(input.to || new Date().getFullYear());
      if ((from && (!/^\d{4}$/.test(from) || from > to || +from < 1996)) || !/^\d{4}$/.test(to) || +to < 1996 || +to > new Date().getFullYear()) return json(res, 400, { error: 'Enter a valid year range from 1996 to today.' });
      const count = [8, 16, 24].includes(Number(input.count)) ? Number(input.count) : 8;
      const id = keyFor(JSON.stringify([url, from, to, count, RENDER_VERSION]));
      if (jobs.has(id)) return json(res, 200, { id, url });
      try {
        const saved = JSON.parse(await readFile(resolve(root, `.cache/job-${id}.json`), 'utf8'));
        if (saved.events.at(-1)?.type === 'done' && !saved.events.some(event => event.type === 'error' || event.capture?.error)) {
          jobs.set(id, { events: saved.events, listeners: new Set(), done: true });
          return json(res, 200, { id, url });
        }
      } catch {}
      if (children.size) return json(res, 429, { error: 'Another timeline is rendering. Try again when it finishes.' });
      const job = { events: [], listeners: new Set(), done: false };
      jobs.set(id, job);
      const add = event => {
        job.events.push(event);
        for (const client of job.listeners) client.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'done' || event.type === 'error') {
          job.done = true;
          for (const client of job.listeners) client.end();
          job.listeners.clear();
        }
      };
      const guard = resolve(process.env.HOME || homedir(), '.claude/scripts/heavy-job.py');
      const hasGuard = await access(guard).then(() => true, () => false);
      const command = process.env.BETTER_WAYBACK_NO_QUEUE === '1' || !hasGuard ? [process.execPath, [resolve(root, 'worker.js'), url, from, to, String(count)]] : ['python3', [guard, '--wait', '--', process.execPath, resolve(root, 'worker.js'), url, from, to, String(count)]];
      const child = spawn(command[0], command[1], { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      children.add(child);
      add({ type: 'status', message: 'Queued for rendering…' });
      let buffer = '', stderr = '';
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          try { const event = JSON.parse(line); if (event.type) add(event); } catch {}
        }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
      const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} add({ type: 'error', message: 'Rendering timed out after 15 minutes. Try fewer captures.' }); }, 15 * 60 * 1000);
      child.on('error', e => { clearTimeout(timer); children.delete(child); add({ type: 'error', message: e.message }); });
      child.on('exit', code => {
        clearTimeout(timer); children.delete(child);
        if (!job.done) add({ type: 'error', message: `Renderer stopped (${code}). ${stderr.slice(-400)}` });
        if (job.events.some(e => e.type === 'error' || e.capture?.error)) jobs.delete(id);
        else { mkdir('.cache', { recursive: true }).then(() => writeFile(`.cache/job-${id}.json`, JSON.stringify({ url, from, to, count, events: job.events }))).catch(console.error); }
      });
      return json(res, 202, { id, url });
    }
    if (req.method === 'GET' && /^\/api\/jobs\/[a-f0-9]{24}\/events$/.test(path)) {
      const job = jobs.get(path.split('/')[3]);
      if (!job) return json(res, 404, { error: 'Timeline not found. Run the search again.' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      for (const event of job.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (job.done) return res.end();
      job.listeners.add(res);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 10000);
      req.on('close', () => { clearInterval(heartbeat); job.listeners.delete(res); });
      res.on('finish', () => clearInterval(heartbeat));
      return;
    }
    const files = { '/': ['public/index.html', 'text/html'], '/examples.js': ['public/examples.js', 'text/javascript'], '/previews.js': ['public/previews.js', 'text/javascript'], '/support.js': ['public/support.js', 'text/javascript'], '/app.js': ['public/app.js', 'text/javascript'], '/style.css': ['public/style.css', 'text/css'], '/group.js': ['group.js', 'text/javascript'], '/logo.svg': ['public/logo.svg','image/svg+xml'], '/logo.png': ['public/logo.png','image/png'], '/favicon.svg': ['public/favicon.svg','image/svg+xml'], '/favicon.ico': ['public/favicon.ico','image/x-icon'], '/favicon-32.png': ['public/favicon-32.png','image/png'], '/apple-touch-icon.png': ['public/apple-touch-icon.png','image/png'], '/icon-512.png': ['public/icon-512.png','image/png'] };
    const file = files[path] || (/^\/cache\/[a-f0-9]{24}\.png$/.test(path) ? [`.cache/${path.split('/').at(-1)}`, 'image/png'] : null);
    if (!['GET', 'HEAD'].includes(req.method) || !file) return json(res, 404, { error: 'Not found' });
    const data = await readFile(resolve(root, file[0]));
    res.writeHead(200, { 'Content-Type': file[1], 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com https://web.archive.org; base-uri 'none'" });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) { json(res, error.code === 'ENOENT' ? 404 : 500, { error: error.message }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Visual Wayback: http://localhost:${server.address().port}`));
function shutdown() {
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  server.close();
  setTimeout(() => {
    for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    process.exit(0);
  }, 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

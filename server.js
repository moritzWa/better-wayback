import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { normalizeUrl, keyFor, RENDER_VERSION } from './lib.js';
import { handleBlogRequest, blogScriptHashes } from './blog.js';

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
    if (req.method === 'GET' || req.method === 'HEAD') {
      const blog = handleBlogRequest(path);
      if (blog) {
        res.writeHead(blog.status, {
          'Content-Type': blog.contentType,
          'Content-Security-Policy': `default-src 'none'; style-src 'self'; script-src ${blogScriptHashes.join(' ')}; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
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
      const from = String(input.from || '1996'), to = String(input.to || new Date().getFullYear());
      if (!/^\d{4}$/.test(from) || !/^\d{4}$/.test(to) || from > to || +from < 1996 || +to > new Date().getFullYear()) return json(res, 400, { error: 'Enter a valid year range from 1996 to today.' });
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
      const guard = resolve(process.env.HOME, '.claude/scripts/heavy-job.py');
      const command = process.env.BETTER_WAYBACK_NO_QUEUE === '1' ? [process.execPath, [resolve(root, 'worker.js'), url, from, to, String(count)]] : ['python3', [guard, '--wait', '--', process.execPath, resolve(root, 'worker.js'), url, from, to, String(count)]];
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
    const files = { '/': ['public/index.html', 'text/html'], '/app.js': ['public/app.js', 'text/javascript'], '/style.css': ['public/style.css', 'text/css'], '/group.js': ['group.js', 'text/javascript'] };
    const file = files[path] || (/^\/cache\/[a-f0-9]{24}\.png$/.test(path) ? [`.cache/${path.split('/').at(-1)}`, 'image/png'] : null);
    if (!['GET', 'HEAD'].includes(req.method) || !file) return json(res, 404, { error: 'Not found' });
    const data = await readFile(resolve(root, file[0]));
    res.writeHead(200, { 'Content-Type': file[1], 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'none'; base-uri 'none'" });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) { json(res, error.code === 'ENOENT' ? 404 : 500, { error: error.message }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Better Wayback: http://localhost:${server.address().port}`));
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

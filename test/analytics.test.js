import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { handleAnalytics } from '../cloudflare/analytics.js';

const payload = () => ({ id: randomUUID(), session: randomUUID(), search: randomUUID(), event: 'timeline_ready', mode: 'custom', source: 'user', cache: 'yes', duration_ms: 500 });
function request(data, headers = {}) {
  return new Request('https://visualwayback.com/api/analytics', { method: 'POST', headers: { Origin: 'https://visualwayback.com', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', ...headers }, body: typeof data === 'string' ? data : JSON.stringify(data) });
}
test('analytics accepts only allowlisted fields and never stores URLs or headers', async () => {
  const writes = [];
  const env = { ANALYTICS: { prepare(sql) { return { bind(...args) { return { run: async () => writes.push({ sql, args }) }; } }; } } };
  const data = { ...payload(), url: 'https://private.example/secret', ip: '1.2.3.4' };
  assert.equal((await handleAnalytics(request(data), env)).status, 204);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].args.length, 13);
  assert.deepEqual(writes[0].args.slice(10), [0, 0, 0], 'non-health events never carry preview counts');
  assert.ok(!JSON.stringify(writes).includes('private.example'));
  for (const req of [request(data, { Origin: 'https://attacker.example' }), request(data, { 'Sec-Fetch-Site': 'cross-site' }), request(data, { 'User-Agent': 'Googlebot' }), request(data, { 'Content-Type': 'text/plain' }), request('x'.repeat(1025)), request('{'), request({ ...data, id: 'invalid' }), request({ ...data, duration_ms: -1 }), request({ ...data, event: 'secret' })]) {
    assert.equal((await handleAnalytics(req, env)).status, 204);
  }
  assert.equal(writes.length, 1);
  assert.equal((await handleAnalytics(request(data), {})).status, 204);
  assert.equal((await handleAnalytics(request(data), { ANALYTICS: { prepare() { throw new Error('Quota exceeded'); } } })).status, 204);
  assert.equal((await handleAnalytics(new Request('https://visualwayback.com/api/analytics'), env)).status, 405);
  assert.equal(await handleAnalytics(new Request('https://visualwayback.com/'), env), null);
});

test('real SQLite enforces cap, deduplication and rolling retention', () => {
  const schema = readFileSync(new URL('../cloudflare/analytics.sql', import.meta.url), 'utf8');
  const output = execFileSync('python3', ['-c', `
import sqlite3,sys
c=sqlite3.connect(':memory:')
c.executescript(sys.stdin.read())
def add(id,day):
 c.execute('INSERT OR IGNORE INTO usage_events (id,day,minute,session,search,event,mode,source,cache,duration_ms) VALUES (?,?,?,?,?,?,?,?,?,?)',(id,day,day+'T00:00','session','search','page_view','none','automatic','unknown',0))
add('old','2026-10-01')
for i in range(2010): add(str(i),'2026-11-16')
assert c.execute("SELECT events FROM usage_days WHERE day='2026-11-16'").fetchone()[0]==2000
assert c.execute('SELECT COUNT(*) FROM usage_events').fetchone()[0]==2000
add('0','2026-11-17')
assert c.execute("SELECT COUNT(*) FROM usage_days WHERE day='2026-11-17'").fetchone()[0]==0
add('new','2026-11-17')
assert c.execute("SELECT events FROM usage_days WHERE day='2026-11-17'").fetchone()[0]==1
add('future','2026-12-17')
assert c.execute('SELECT COUNT(*) FROM usage_events').fetchone()[0]==1
print('ok')
`], { input: schema, encoding: 'utf8' });
  assert.equal(output.trim(), 'ok');
});

function client({ host = 'visualwayback.com', query = '', webdriver = false, privacy = false, brokenStorage = false } = {}) {
  const sent = [], values = new Map();
  const scope = { URLSearchParams, location: { hostname: host, search: query }, navigator: { webdriver, globalPrivacyControl: privacy }, sessionStorage: { getItem(k) { if (brokenStorage) throw Error(); return values.get(k); }, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }, crypto: { randomUUID }, performance: { now: () => 100 }, fetch: async (path, options) => { sent.push({ path, options, body: JSON.parse(options.body) }); } };
  vm.createContext(scope);
  vm.runInContext(readFileSync(new URL('../public/analytics.js', import.meta.url), 'utf8').replace('export function', 'function') + '\nthis.api = createAnalytics();', scope);
  return { ...scope, sent };
}
test('client separates automatic demos, deduplicates events and minimizes metadata', () => {
  const c = client();
  c.api.begin('demo', 'automatic'); c.api.ready(); c.api.ready();
  c.api.begin('custom', 'user'); c.api.cache('no'); c.api.cache('yes'); c.api.ready(); c.api.preview(); c.api.preview(); c.api.failed(true); c.api.failed();
  assert.deepEqual(c.sent.map(x => x.body.event), ['page_view', 'search_started', 'timeline_ready', 'search_started', 'timeline_ready', 'preview_opened', 'quota_reached']);
  assert.equal(c.sent[2].body.source, 'automatic');
  assert.equal(c.sent[4].body.cache, 'no');
  assert.equal(c.sent[4].body.source, 'user');
  assert.equal(c.sent[0].body.session, c.sent[4].body.session);
  assert.notEqual(c.sent[2].body.search, c.sent[4].body.search);
  for (const x of c.sent) { assert.equal(x.options.credentials, 'omit'); assert.equal(x.options.referrerPolicy, 'no-referrer'); assert.equal(Object.keys(x.body).length, 8); }
});
test('preview health stores only bounded counts and a single median', async () => {
  const writes = [];
  const env = { ANALYTICS: { prepare() { return { bind(...args) { return { run: async () => writes.push(args) }; } }; } } };
  const health = { ...payload(), event: 'preview_health', loaded: 5, refused: 2, failed: 1, duration_ms: 4200 };
  assert.equal((await handleAnalytics(request(health), env)).status, 204);
  assert.deepEqual(writes[0].slice(9), [4200, 5, 2, 1]);
  for (const bad of [{ loaded: -1 }, { refused: 201 }, { failed: 1.5 }, { loaded: undefined }, { failed: 'x' }]) await handleAnalytics(request({ ...health, id: randomUUID(), ...bad }), env);
  assert.equal(writes.length, 1, 'out-of-range or missing counts are discarded');
  await handleAnalytics(request({ ...payload(), loaded: 9 }), env);
  assert.deepEqual(writes[1].slice(10), [0, 0, 0], 'counts on ordinary events are ignored');
});
test('client batches preview health, never exceeds three batches and skips empty ones', () => {
  const c = client();
  c.api.previews({ loaded: 3 });
  c.api.begin('custom', 'user');
  c.api.previews({}); 
  c.api.previews({ loaded: 3, refused: 4, failed: 1, medianMs: 5000.4 });
  c.api.previews({ refused: 999 }); c.api.previews({ loaded: 1 }); c.api.previews({ loaded: 1 });
  const health = c.sent.filter(x => x.body.event === 'preview_health').map(x => x.body);
  assert.equal(health.length, 3);
  assert.deepEqual([health[0].loaded, health[0].refused, health[0].failed, health[0].duration_ms], [3, 4, 1, 5000]);
  assert.equal(health[1].refused, 200, 'counts are clamped');
  assert.deepEqual(Object.keys(health[0]).sort(), ['cache', 'duration_ms', 'event', 'failed', 'id', 'loaded', 'mode', 'refused', 'search', 'session', 'source']);
});
test('test hosts, WebDriver, opt-out, privacy signals and unavailable storage send nothing', () => {
  for (const options of [{ host: 'localhost' }, { query: '?analytics=off' }, { webdriver: true }, { privacy: true }, { brokenStorage: true }]) {
    const c = client(options); c.api.begin('custom', 'user'); c.api.ready(); c.api.failed(); c.api.preview();
    assert.equal(c.sent.length, 0);
  }
});

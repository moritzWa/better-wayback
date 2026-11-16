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
  assert.equal(writes[0].args.length, 10);
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
 c.execute('INSERT OR IGNORE INTO usage_events VALUES (?,?,?,?,?,?,?,?,?,?)',(id,day,day+'T00:00','session','search','page_view','none','automatic','unknown',0))
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
test('test hosts, WebDriver, opt-out, privacy signals and unavailable storage send nothing', () => {
  for (const options of [{ host: 'localhost' }, { query: '?analytics=off' }, { webdriver: true }, { privacy: true }, { brokenStorage: true }]) {
    const c = client(options); c.api.begin('custom', 'user'); c.api.ready(); c.api.failed(); c.api.preview();
    assert.equal(c.sent.length, 0);
  }
});

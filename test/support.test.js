import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleSupportRequest } from '../support.mjs';
import { handleBlogRequest } from '../blog.js';

const email = 'support@example.invalid';
const makeEnv = () => {
  const store = new Map();
  return { SUPPORT_EMAIL: email, TURNSTILE_SITE_KEY: 'public-test-key', TURNSTILE_SECRET_KEY: 'private-test-key',
    CACHE: { get: async key => store.get(key) ?? null, put: async (key, value, options) => {
      assert.match(key, /^support:rate:\d+:[a-f0-9]{64}$/);
      assert.equal(options.expirationTtl, 1200);
      assert.ok(!value.includes(email)); store.set(key, value);
    } } };
};
const request = (body = { token: 'test-token' }, headers = {}, method = 'POST', path = '/api/support/reveal') => new Request(`https://example.invalid${path}`, {
  method, headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...headers },
  ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
});

test('support endpoint security and privacy', async t => {
  const original = globalThis.fetch;
  let calls = 0, result = { success: true, hostname: 'example.invalid', action: 'support-reveal' };
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(options.body.get('secret'), 'private-test-key');
    assert.equal(options.body.get('response'), 'test-token');
    return Response.json(result);
  };
  t.after(() => { globalThis.fetch = original; });
  await t.test('public configuration contains only public key, no-store', async () => {
    const response = await handleSupportRequest(request(null, {}, 'GET', '/api/support/config'), makeEnv());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { siteKey: 'public-test-key' });
    assert.equal((await handleSupportRequest(request(null, {}, 'GET'), makeEnv())).status, 405);
    assert.equal(await handleSupportRequest(new Request('https://example.invalid/'), makeEnv()), null);
  });
  await t.test('missing settings fail closed', async () => {
    for (const key of ['SUPPORT_EMAIL', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'CACHE']) {
      const env = makeEnv(); delete env[key];
      const response = await handleSupportRequest(request(), env);
      assert.equal(response.status, 503); assert.ok(!(await response.text()).includes(email));
    }
  });
  await t.test('origin, content type, size and token validation precede verification', async () => {
    const before = calls;
    for (const [req, status] of [
      [request({}, { Origin: 'https://evil.invalid' }), 403],
      [request({}, { Origin: '' }), 403],
      [request({}, { 'Sec-Fetch-Site': 'cross-site' }), 403],
      [request({}, { 'Content-Type': 'text/plain' }), 415],
      [request('x'.repeat(4097)), 413], [request('{bad'), 400],
      [request({ token: '' }), 400], [request({ token: 'x'.repeat(2049) }), 400],
    ]) assert.equal((await handleSupportRequest(req, makeEnv())).status, status);
    assert.equal(calls, before);
  });
  await t.test('only valid action and hostname reveal email', async () => {
    for (const bad of [{ success: false }, { success: true, hostname: 'evil.invalid', action: 'support-reveal' },
      { success: true, hostname: 'example.invalid', action: 'other' }]) {
      result = bad;
      const response = await handleSupportRequest(request(), makeEnv());
      assert.equal(response.status, 403); assert.ok(!(await response.text()).includes(email));
    }
    result = { success: true, hostname: 'example.invalid', action: 'support-reveal' };
    const response = await handleSupportRequest(request(), makeEnv());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { mailto: `mailto:${email}` });
  });
  await t.test('rate limit and global KV budget fail closed', async () => {
    const env = makeEnv();
    for (let i = 0; i < 5; i++) assert.equal((await handleSupportRequest(request(), env)).status, 200);
    const before = calls;
    assert.equal((await handleSupportRequest(request(), env)).status, 429);
    env.QUOTAS = { idFromName: name => name, get: () => ({ fetch: async () => new Response('', { status: 429 }) }) };
    assert.equal((await handleSupportRequest(request(null, { 'CF-Connecting-IP': '192.0.2.2' }), env)).status, 429);
    assert.equal(calls, before);
  });
  await t.test('verification and rate-store failures never expose secrets', async () => {
    globalThis.fetch = async () => { throw new Error(email); };
    const response = await handleSupportRequest(request(), makeEnv());
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes(email));
    const env = makeEnv(); env.CACHE.get = async () => { throw new Error(email); };
    assert.equal((await handleSupportRequest(request(), env)).status, 503);
  });
});

test('initial homepage, blog and client module contain no support address', async () => {
  for (const body of [await readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    await readFile(new URL('../public/support.js', import.meta.url), 'utf8'), handleBlogRequest('/blog/').body]) {
    assert.ok(!body.includes(email));
    assert.ok(!body.includes('private-test-key'));
    assert.ok(!body.includes('mailto:support'));
  }
});

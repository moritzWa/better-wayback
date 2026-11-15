import { test } from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.BETTER_WAYBACK_TEST_URL;

test('API rejects bad inputs before starting resource-heavy work', { skip: !base }, async () => {
  for (const input of [{ url: '127.0.0.1' }, { url: 'https://example.com:9999' }, { url: 'example.com', from: '2030', to: '1996' }]) {
    const response = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error);
  }
});
test('cross-origin job creation and cache traversal are rejected', { skip: !base }, async () => {
  const response = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ url: 'example.com' }) });
  assert.equal(response.status, 403);
  assert.equal((await fetch(`${base}/cache/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/jobs/${'a'.repeat(24)}/events`)).status, 404);
});

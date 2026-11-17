import test from 'node:test';
import assert from 'node:assert/strict';
import { requestSearchJob } from '../public/search-request.js';

const job = { id: 'a'.repeat(24), url: 'https://facebook.com/' };
test('Facebook search recovers once from intermediary HTML and preserves request parameters', async () => {
  for (const status of [200, 502, 503, 504]) {
    let calls = 0;
    const input = { url: 'facebook.com', previewMode: 'html', count: '8', from: '', to: '' };
    const result = await requestSearchJob(input, { fetchRequest: async (path, options) => {
      assert.equal(path, '/api/jobs'); assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), input); assert.ok(options.signal);
      return ++calls === 1 ? new Response('<!DOCTYPE html><title>Bad gateway</title>', { status }) : Response.json(job);
    } });
    assert.deepEqual(result, job); assert.equal(calls, 2);
  }
});
test('persistent HTML errors are readable, bounded, and never leak the JSON parser or upstream body', async () => {
  let calls = 0;
  await assert.rejects(requestSearchJob({}, { fetchRequest: async () => { calls++; return new Response('<!DOCTYPE html>private proxy body', { status: 502 }); } }), error => {
    assert.match(error.message, /temporarily unavailable.*try again/i);
    assert.doesNotMatch(error.message, /DOCTYPE|private|Unexpected token|JSON/);
    return true;
  });
  assert.equal(calls, 2);
});
test('intentional API errors, permission denials and invalid job objects do not retry', async () => {
  for (const response of [Response.json({ error: 'Free quota reached.' }, { status: 429 }), Response.json({ error: 'The Internet Archive is unavailable.' }, { status: 502 }), new Response('<!DOCTYPE html>Forbidden', { status: 403 }), Response.json({})]) {
    let calls = 0;
    await assert.rejects(requestSearchJob({}, { fetchRequest: async () => { calls++; return response; } }));
    assert.equal(calls, 1);
  }
});
test('cancelling search aborts before an HTML retry', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(requestSearchJob({}, { signal: controller.signal, fetchRequest: async (path, options) => {
    calls++; controller.abort(); assert.equal(options.signal.aborted, true);
    return new Response('<html>interrupted');
  } }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

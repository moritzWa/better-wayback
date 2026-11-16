import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupCaptureIndex } from '../archive-index.js';
import { selectCaptures, groupCaptures } from '../lib.js';
import { performance } from 'node:perf_hooks';

const row = timestamp => ({ timestamp, original: 'https://amazon.com/', digest: timestamp });
const timeout = () => new DOMException('delayed index', 'TimeoutError');
test('Amazon-style dense history uses at most two small window queries, includes both endpoints and supports 24 captures', async () => {
  let active = 0, peak = 0; const calls = [];
  const rows = await lookupCaptureIndex(async params => {
    calls.push(params); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    if (params.collapse) return Array.from({ length: 1200 }, (_, i) => row(`19990828${String(i).padStart(6, '0')}`));
    if (params.fastLatest) return [row('20261115000000')];
    assert.equal(params.limit, '1'); assert.ok(params.from < params.to);
    return [row(params.from)];
  }, '', '2026');
  assert.equal(calls.length, 26); assert.ok(peak <= 2);
  assert.ok(calls.slice(1).every(p => !p.collapse));
  const selected = selectCaptures(rows, 24);
  assert.equal(selected.length, 24); assert.equal(selected[0].timestamp, '19990828000000'); assert.equal(selected.at(-1).timestamp, '20261115000000');
  assert.equal(rows.indexSampled, true); assert.equal(rows.indexCapped, true); assert.equal(rows.indexWarning, '');
});
test('initial timeout recovers by finding endpoints and bounded windows, without reporting no captures', async () => {
  const rows = await lookupCaptureIndex(async p => {
    if (p.collapse) throw timeout();
    if (p.fastLatest) return [row('20260101000000')];
    if (p.from === '') return [row('20000101000000')];
    return [row(p.from)];
  }, '', '2026');
  assert.ok(rows.length >= 24); assert.equal(rows.indexTotal, 0); assert.equal(rows.indexSampled, true);
});
test('one failed window retains other results with an explicit partial warning, not cached completeness', async () => {
  let windows = 0;
  const rows = await lookupCaptureIndex(async p => {
    if (p.collapse) throw timeout();
    if (p.fastLatest) return [row('20260101000000')];
    if (p.from === '2000') return [row('20000101000000')];
    if (++windows === 3) throw timeout();
    return [row(p.from)];
  }, '2000', '2026');
  assert.match(rows.indexWarning, /1 bounded date lookups timed out/); assert.ok(rows.length > 10);
});
test('throttling, malformed responses and cancellation never trigger a 24-request retry storm', async () => {
  for (const error of [new Error('Wayback returned 429'), new Error('Unexpected archive index response'), new DOMException('cancelled', 'AbortError')]) {
    let calls = 0;
    await assert.rejects(lookupCaptureIndex(async () => { calls++; throw error; }, '', '2026'), error);
    assert.equal(calls, 1);
  }
});
test('all deadline failures remain an explicit lookup failure rather than an empty history', async () => {
  await assert.rejects(lookupCaptureIndex(async () => { throw timeout(); }, '', '2026'), /timed out/);
});
test('24 long comparisons remain equivalent and inexpensive across repeated slider regrouping', () => {
  const captures = Array.from({ length: 24 }, (_, i) => ({ timestamp: `${2000+i}0101000000`, text: Array.from({length: 1800}, (_, n) => `word${n + i * 2}`).join(' ').slice(0, 12000) }));
  const reference = groupCaptures(captures, .98);
  const start = performance.now();
  for (let i = 0; i < 100; i++) groupCaptures(captures, .9 + i % 10 / 100);
  assert.ok(performance.now() - start < 1000, 'Repeated comparisons must reuse bounded token/score caches');
  assert.deepEqual(groupCaptures(captures, .98), reference);
  captures[1].text = 'completely replaced content';
  assert.ok(groupCaptures(captures, .98).some(c => c.text === 'completely replaced content'), 'Updates must not reuse stale text scores');
});

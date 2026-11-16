import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, normalizeUrl, similarity, selectCaptures, groupCaptures, replayUrl, fetchCaptures } from '../lib.js';

test('normalizes public URLs and rejects credentials / local networks', () => {
  assert.equal(normalizeUrl('example.com/path#part'), 'https://example.com/path');
  assert.equal(normalizeUrl('http://www.example.com/'), 'http://www.example.com/');
  for (const url of ['localhost', '127.0.0.1', '10.0.0.1', '172.17.0.1', '192.168.1.1', 'https://user:pass@example.com', 'https://example.com:4321']) assert.throws(() => normalizeUrl(url));
});
test('clean text ignores whitespace and volatile times, retains amounts and years', () => {
  assert.equal(cleanText('Price  $49\n\n  Updated 12:34 PM in 2024'), 'Price $49\n Updated in 2024');
});
test('text equality and differences', () => {
  assert.equal(similarity('same words here', 'same words here'), 1);
  assert.equal(similarity('a b c', 'x y z'), 0);
  assert.ok(similarity('the website has a new product for everyone', 'the website has a new product for teams') < 0.9);
});
test('sampling includes endpoints, stays ordered, and avoids duplicate indices', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ timestamp: `${1900 + i}0101000000` }));
  const result = selectCaptures(rows, 8);
  assert.equal(result.length, 8); assert.equal(result[0], rows[0]); assert.equal(result.at(-1), rows[99]);
  assert.equal(new Set(result).size, 8);
  assert.deepEqual(selectCaptures(rows.slice(0, 2), 8), rows.slice(0, 2));
});
test('dense recent activity does not crowd early years out of elapsed-time sampling', () => {
  const rows = ['19960101000000', '20000101000000', '20050101000000', '20100101000000', '20150101000000', '20200101000000', ...Array.from({ length: 100 }, (_, i) => `20260101${String(i).padStart(6, '0')}`)].map(timestamp => ({ timestamp }));
  const result = selectCaptures(rows, 4);
  assert.deepEqual(result.map(row => row.timestamp.slice(0, 4)), ['1996', '2005', '2015', '2026']);
});
test('blank starting year leaves the CDX query unbounded rather than inventing 1996', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(new URL(url).searchParams.has('from'), false);
    return { ok: true, json: async () => [['timestamp', 'original', 'digest'], ['20010301000000', 'https://example.com/', 'X']] };
  };
  try { assert.equal((await fetchCaptures('https://example.com/', '', '2026'))[0].timestamp, '20010301000000'); }
  finally { globalThis.fetch = originalFetch; }
});
test('groups adjacent duplicates, preserves reversions, excludes failed captures', () => {
  const captures = [
    { timestamp: '20000101000000', text: 'version one is the first page' },
    { timestamp: '20010101000000', text: 'version one is the first page' },
    { timestamp: '20020101000000', error: 'broken' },
    { timestamp: '20030101000000', text: 'completely different products and new prices' },
    { timestamp: '20040101000000', text: 'version one is the first page' },
  ];
  const groups = groupCaptures(captures);
  assert.equal(groups.length, 3); assert.equal(groups[0].count, 2);
  assert.equal(groups[0].lastTimestamp, '20010101000000'); assert.equal(groups[0].change, null);
  assert.equal(captures[0].count, undefined);
});
test('raw replay URLs preserve source and validate timestamps', () => {
  assert.equal(replayUrl('20200101000000', 'https://example.com/', true), 'https://web.archive.org/web/20200101000000id_/https://example.com/');
  assert.throws(() => replayUrl('../bad', 'https://example.com'));
});
test('dense index uses bounded date queries rather than a full monthly collapse scan', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(new URL(url));
    const rows = requests.length === 1 ? Array.from({ length: 1200 }, () => ['20120101000000', 'https://example.com/', 'ABC']) : [['20120101000000', 'https://example.com/', 'ABC'], ['20260101000000', 'https://example.com/', 'DEF']];
    return { ok: true, json: async () => [['timestamp', 'original', 'digest'], ...rows] };
  };
  try {
    const rows = await fetchCaptures('https://example.com/', '2012', '2026');
    assert.equal(requests.length, 26);
    assert.ok(requests.slice(1).every(url => !url.searchParams.has('collapse')));
    assert.equal(requests[1].searchParams.get('fastLatest'), 'true');
    assert.equal(rows.at(-1).timestamp, '20260101000000');
    assert.equal(rows.indexCapped, true); assert.equal(rows.indexTotal, 1200);
  } finally { globalThis.fetch = originalFetch; }
});
test('upstream throttling is an explicit error, not an empty successful timeline', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 429 });
  try { await assert.rejects(fetchCaptures('https://example.com/', '2012', '2026'), /429/); }
  finally { globalThis.fetch = originalFetch; }
});

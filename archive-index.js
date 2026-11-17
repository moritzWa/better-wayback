// Avoid full-history collapse scans on dense URLs. All fallback queries have a
// small positive limit, except CDX's documented indexed fastLatest endpoint.
export async function lookupCaptureIndex(query, from, to) {
  let rows = [], timedOut = false;
  try { rows = await query({ collapse: 'digest', limit: '1200', from, to }); }
  catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    timedOut = true;
  }
  if (!timedOut && rows.length < 1200) return Object.assign(rows, { indexTotal: rows.length, indexCapped: false });
  const total = rows.length;
  let failures = 0;
  const attempt = async params => {
    try { return await query(params); }
    catch (error) {
      // Never disguise throttling, malformed responses or unsafe redirects as a
      // successful partial index. Only independent network deadlines can degrade.
      if (error.name !== 'TimeoutError') throw error;
      failures++; return [];
    }
  };
  const [first, last] = await Promise.all([
    rows.length ? [rows[0]] : attempt({ limit: '1', from, to }),
    attempt({ limit: '-1', fastLatest: 'true', from, to }),
  ]);
  const candidates = [...rows, ...first, ...last];
  const time = stamp => Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12), +stamp.slice(12, 14));
  const stamp = ms => new Date(ms).toISOString().replace(/\D/g, '').slice(0, 14);
  const start = first.length ? time(first[0].timestamp) : Date.UTC(+(from || 1996), 0, 1);
  const end = last.length ? time(last.at(-1).timestamp) : Math.min(Date.now(), Date.UTC(+to + 1, 0, 1) - 1000);
  const windows = Array.from({ length: 24 }, (_, i) => ({ limit: '1', from: stamp(start + (end - start) * i / 24), to: stamp(start + (end - start) * (i + 1) / 24) }));
  let next = 0, stopped;
  const worker = async () => {
    while (next < windows.length && !stopped) {
      const params = windows[next++];
      try { candidates.push(...await attempt(params)); }
      catch (error) { stopped = error; }
    }
  };
  await Promise.all([worker(), worker()]);
  if (stopped) throw stopped;
  if (!candidates.length && failures) throw new DOMException('Archive index lookup timed out. Please retry later.', 'TimeoutError');
  const unique = new Map(candidates.map(row => [`${row.timestamp}:${row.original}`, row]));
  return Object.assign([...unique.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)), {
    indexTotal: total, indexCapped: total === 1200, indexSampled: true,
    indexWarning: failures ? `Partial archive index: ${failures} bounded date lookups timed out. Available captures are kept; some dates may be missing.` : '',
  });
}

// A proxy can return HTML (even HTTP 200) instead of CDX JSON. Retry that
// response once, not the entire date-window lookup, and never expose its body.
export async function readArchiveIndex(fetchResponse, readBody = response => response.text(), { retry = () => true } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchResponse();
    if (!response.ok) {
      await response.body?.cancel();
      if (!attempt && [500, 502, 503, 504].includes(response.status) && retry()) continue;
      throw new Error(`Wayback returned ${response.status}. Please try again later.`);
    }
    const body = await readBody(response);
    let data;
    try { data = JSON.parse(body); }
    catch {
      if (!attempt && retry()) continue;
      throw new Error('The Internet Archive returned an unreadable index response. Please try again later.');
    }
    if (!Array.isArray(data)) throw new Error('Unexpected archive index response. Please try again later.');
    return data;
  }
}

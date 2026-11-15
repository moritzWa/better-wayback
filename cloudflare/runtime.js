import { normalizeUrl, keyFor, selectCaptures, replayUrl, RENDER_VERSION, USER_AGENT } from '../lib.js';
import { quota } from './quota.js';
import { HTML_VERSION, MAX_HTML, iframeUrl, archiveHtmlAllowed } from './html.js';

export const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_JSON = 65536;
const TTL = 7 * 86400;
const FAILURE_TTL = 3600;
const json = (status, body) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...(body.retryAfter ? { 'Retry-After': String(body.retryAfter) } : {}) } });
const captureKey = capture => keyFor(capture.timestamp + capture.original + ':' + RENDER_VERSION);
async function boundedText(response, limit) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Archive response exceeds the free runtime size limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
async function cached(env, capture, ignoreFailures = false) {
  if (!env.CACHE) return null;
  const key = captureKey(capture);
  const saved = await env.CACHE.get(`capture:${key}`, 'json');
  if (saved && saved.renderVersion === RENDER_VERSION && !saved.error && saved.text && saved.image === `/cache/${key}.png`) {
    // Publish only complete pairs, even after a failed or partially propagated KV write.
    const image = await env.CACHE.get(`image:${key}`, 'stream');
    if (image) {
      // Check existence without downloading every full PNG into the Worker again.
      await image.cancel?.();
      return saved;
    }
  }
  if (ignoreFailures) return null;
  const failed = await env.CACHE.get(`failure:${key}`, 'json');
  return failed?.renderVersion === RENDER_VERSION && failed.error && !failed.image && failed.failureExpiresAt > Date.now() ? failed : null;
}

export function createRuntime({ launch, render, extractHtml, fetchArchive = fetch }) {
  async function createJob(request, env) {
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json(403, { error: 'Cross-origin requests are not allowed.' });
    let input, url;
    try { input = JSON.parse(await boundedText(request, 4096)); url = normalizeUrl(String(input.url || '')); }
    catch (error) { return json(400, { error: error.message }); }
    if (env.PREVIEW_MODE === 'html' && input.previewMode !== 'html') return json(409, { error: 'Visual Wayback has updated its previews. Reload this page and search again.' });
    const from = String(input.from || ''), to = String(input.to || new Date().getUTCFullYear());
    if ((from && (!/^\d{4}$/.test(from) || +from < 1996 || from > to)) || !/^\d{4}$/.test(to) || +to < 1996 || +to > new Date().getUTCFullYear()) return json(400, { error: 'Enter a valid year range from 1996 to today.' });
    const count = [8, 16, 24].includes(Number(input.count)) ? Number(input.count) : 8;
    const id = keyFor(JSON.stringify([url, from, to, count, RENDER_VERSION, ...(env.PREVIEW_MODE === 'html' ? [HTML_VERSION] : [])]));
    if (!env.CACHE) return json(503, { error: 'Archive cache is not configured. Packaged examples still work.' });
    if (await env.CACHE.get(`job:${id}`)) return json(200, { id, url });
    const allowance = await quota(env, 'job');
    if (!allowance.ok) return json(429, allowance);
    try {
      const params = new URLSearchParams({ url, output: 'json', filter: 'statuscode:200', collapse: 'digest', fl: 'timestamp,original,digest', limit: '1200' });
      if (from) params.set('from', from);
      params.set('to', to);
      const query = async () => {
        // Workers supports follow/manual, not Node's redirect:'error'. Manual keeps
        // archive redirects from reaching any other host; non-2xx fails below.
        const response = await fetchArchive(`https://web.archive.org/cdx/search/cdx?${params}`, { headers: { 'User-Agent': USER_AGENT }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`Wayback returned ${response.status}. Please retry later.`);
        const data = JSON.parse(await boundedText(response, 512 * 1024));
        if (!Array.isArray(data)) throw new Error('Unexpected archive index response');
        return data.slice(1, 1201).filter(row => Array.isArray(row) && /^\d{14}$/.test(row[0]) && /^https?:\/\//.test(row[1]) && row[1].length <= 4096).map(([timestamp, original, digest]) => ({ timestamp, original, digest }));
      };
      let rows = await query();
      const total = rows.length, capped = total === 1200;
      if (capped) { params.set('collapse', 'timestamp:6'); rows = await query(); }
      const captures = selectCaptures(rows, count);
      if (!captures.length) return json(404, { error: 'No successful captures found for this URL and date range.' });
      const job = { url, captures, index: { type: 'index', total, capped, monthly: capped, sampled: captures.length, captures, firstTimestamp: rows[0]?.timestamp, lastTimestamp: rows.at(-1)?.timestamp } };
      const encoded = JSON.stringify(job);
      if (new TextEncoder().encode(encoded).byteLength > MAX_JSON) return json(413, { error: 'Timeline exceeds the free runtime size limit.' });
      await env.CACHE.put(`job:${id}`, encoded, { expirationTtl: 86400 });
      return json(202, { id, url });
    } catch (error) { return json(502, { error: error.message, retryAfter: 60 }); }
  }

  async function htmlEvents(request, env, id) {
    const job = await env.CACHE?.get(`job:${id}`, 'json');
    if (!job) return json(404, { error: 'Timeline expired. Search again; cached previews are kept.' });
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) abort.abort();
    let stopped = false;
    const stream = new ReadableStream({
      async start(controller) {
        const emit = event => { if (!stopped && !abort.signal.aborted) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); };
        const compose = (capture, png, html) => {
          if (html?.comparisonUnavailable && png) return { ...png, preview: 'image', previewUrl: iframeUrl(capture), textSource: 'rendered', textPending: false, textError: 'HTML comparison unavailable; using cached screenshot text.' };
          return { ...capture, requestedTimestamp: capture.timestamp, archiveUrl: replayUrl(capture.timestamp, capture.original), preview: 'iframe', previewUrl: iframeUrl(capture), text: '', textSource: 'html', comparisonUnavailable: true, ...html, ...(png ? { title: png.title || html?.title, image: png.image, preview: 'image' } : {}) };
        };
        const htmlKey = capture => `html:${HTML_VERSION}:${captureKey(capture)}`;
        let completed = 0;
        try {
          emit({ ...job.index, textSource: 'html', previewMode: 'html' });
          const items = await Promise.all(job.captures.map(async capture => {
            const [png, saved] = await Promise.all([cached(env, capture, true), env.CACHE.get(htmlKey(capture), 'json')]);
            const html = saved?.htmlVersion === HTML_VERSION && typeof saved.text === 'string' && (!saved.failureExpiresAt || saved.failureExpiresAt > Date.now()) ? saved : null;
            emit({ type: 'capture', capture: html ? compose(capture, png, html) : { ...compose(capture, png), ...(png ? { text: png.text, textSource: 'rendered', comparisonUnavailable: false } : {}), textPending: true }, cached: Boolean(png || html), completed: ++completed });
            return { capture, png, html };
          }));
          const missing = items.filter(item => !item.html);
          if (!missing.length) { emit({ type: 'done' }); return; }
          if (!extractHtml) { emit({ type: 'error', message: 'HTML comparison is unavailable. Direct archive previews remain accessible.' }); return; }
          emit({ type: 'status', message: 'Reading archived HTML for text comparisons. Live previews load separately…' });
          let next = 0, terminal;
          // Bound upstream traffic and the per-request external subrequest count.
          const batch = missing.slice(0, 8);
          const read = async item => {
            const allowance = await quota(env, 'write');
            if (!allowance.ok) { terminal = allowance; return; }
            let metadata, ttl = TTL;
            try {
              const started = Date.now();
              const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]);
              let url = iframeUrl(item.capture), response;
              for (let redirect = 0; redirect < 4; redirect++) {
                if (!archiveHtmlAllowed(url)) throw new Error('Non-archive replay redirect rejected.');
                response = await fetchArchive(url, { redirect: 'manual', signal, headers: { 'User-Agent': USER_AGENT } });
                if (response.status < 300 || response.status >= 400) break;
                const location = response.headers.get('location');
                await response.body?.cancel();
                if (!location || redirect === 3) throw new Error('Archive replay redirected too many times.');
                url = new URL(location, url).href;
              }
              if (!response.ok) { const error = new Error(`Wayback returned ${response.status}.`); error.status = response.status; throw error; }
              if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) throw new Error('Archived content is not an HTML page.');
              const html = await boundedText(response, MAX_HTML);
              if (abort.signal.aborted) return;
              const actualTimestamp = url.match(/\/web\/(\d{14})/)?.[1] || item.capture.timestamp;
              metadata = { ...await extractHtml(html), timestamp: actualTimestamp, archiveUrl: replayUrl(actualTimestamp, item.capture.original), htmlVersion: HTML_VERSION, textSource: 'html', textPending: false, timing: { htmlMs: Date.now() - started } };
              if (/Your IP address has reached|Rate limit exceeded|Wayback Machine has not archived that URL|This URL has been excluded/i.test(metadata.text)) throw new Error('Archive replay is unavailable.');
              if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > MAX_JSON) metadata = { htmlVersion: HTML_VERSION, textSource: 'html', textPending: false, text: '', comparisonUnavailable: true, textError: 'HTML text exceeds the comparison limit.' };
            } catch (error) {
              if (abort.signal.aborted) return;
              if (error.status === 429 || error.status === 503 || /rate limit/i.test(error.message)) { terminal = { error: 'The Internet Archive is throttling text lookups. Live previews remain accessible.', retryAfter: 90 }; return; }
              ttl = 300;
              metadata = { htmlVersion: HTML_VERSION, textSource: 'html', textPending: false, text: '', comparisonUnavailable: true, textError: String(error.message).slice(0, 500), failureExpiresAt: Date.now() + ttl * 1000 };
            }
            if (abort.signal.aborted || terminal) return;
            await env.CACHE.put(htmlKey(item.capture), JSON.stringify(metadata), { expirationTtl: ttl });
            emit({ type: 'capture', capture: compose(item.capture, item.png, metadata), cached: false, completed });
          };
          await Promise.all(Array.from({ length: 2 }, async () => {
            while (next < batch.length && !terminal && !abort.signal.aborted) await read(batch[next++]);
          }));
          if (terminal) emit({ type: 'error', message: terminal.error, retryAfter: terminal.retryAfter });
          else emit(missing.length > batch.length ? { type: 'continue', source: 'html', retryAfter: 1 } : { type: 'done' });
        } catch { emit({ type: 'error', message: 'HTML comparison stopped. Live archive previews remain accessible.' }); }
        finally {
          stopped = true; request.signal.removeEventListener('abort', onAbort);
          try { controller.close(); } catch {}
        }
      },
      cancel() { stopped = true; abort.abort(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }

  async function events(request, env, id) {
    const job = await env.CACHE?.get(`job:${id}`, 'json');
    if (!job) return json(404, { error: 'Timeline expired. Search again; cached captures are kept.' });
    let browser, cancelled = false, reservationToken, closeConfirmed = false;
    const close = async () => {
      const owned = browser;
      browser = null;
      if (!owned) return;
      let timer;
      try {
        const confirmed = await Promise.race([owned.close().then(() => true, () => false), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); })]);
        if (confirmed && reservationToken) {
          const released = await quota(env, 'release', { token: reservationToken });
          closeConfirmed = released.ok === true;
        }
      }
      finally { clearTimeout(timer); }
    };
    const stream = new ReadableStream({
      async start(controller) {
        const emit = event => { if (!cancelled) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); };
        const abort = () => { cancelled = true; void close(); };
        request.signal.addEventListener('abort', abort, { once: true });
        if (request.signal.aborted) abort();
        let timer, captureTimer, completed = 0, stage = 'cache', attemptFinished = false, activeCapture;
        const missing = [];
        const saveFailure = async capture => {
          const failed = { ...capture, requestedTimestamp: capture.timestamp, archiveUrl: replayUrl(capture.timestamp, capture.original), error: String(capture.failureMessage).slice(0, 1000), renderVersion: RENDER_VERSION, failureExpiresAt: Date.now() + FAILURE_TTL * 1000 };
          delete failed.failureMessage;
          await env.CACHE.put(`failure:${captureKey(capture)}`, JSON.stringify(failed), { expirationTtl: FAILURE_TTL });
          emit({ type: 'capture', capture: failed, cached: false, completed: ++completed });
        };
        const platformFailure = error => error.status === 429 || /429|503|rate limit|cooling|browser.*limit|browser.*closed|Target.*closed/i.test(error.message);
        try {
          emit(job.index);
          const cachedCaptures = await Promise.all(job.captures.map(capture => cached(env, capture)));
          for (let i = 0; i < job.captures.length; i++) {
            const capture = job.captures[i], saved = cachedCaptures[i];
            if (saved) emit({ type: 'capture', capture: saved, cached: true, completed: ++completed });
            else missing.push(capture);
          }
          if (!missing.length) { emit({ type: 'done' }); return; }
          // Missing captures remain in the index, not silently hidden by grouping.
          if (env.ENABLE_RENDERING !== 'true' || !env.BROWSER) { emit({ type: 'error', message: 'New rendering is disabled. Cached previews and packaged examples remain available.' }); return; }
          const requestedBatch = Math.max(1, Math.min(8, Number(env.RENDER_BATCH_SIZE) || 1));
          const allowance = await quota(env, 'render', { count: Math.min(requestedBatch, missing.length) });
          if (!allowance.ok) { emit({ type: 'error', message: allowance.error, retryAfter: allowance.retryAfter }); return; }
          reservationToken = allowance.token;
          if (cancelled) return;
          const batch = missing.slice(0, allowance.captures || 1);
          activeCapture = batch[0];
          emit({ type: 'status', message: `Loading ${batch.length} archived preview${batch.length === 1 ? '' : 's'} in one browser…` });
          // All work belongs to this connected response. Never rely on waitUntil.
          const timeout = new Promise((_, reject) => { timer = setTimeout(() => { attemptFinished = true; void close(); reject(new Error('Capture exceeded the free runtime batch deadline. Retry later; cached previews are kept.')); }, 25000 * batch.length); });
          const work = (async () => {
            stage = 'launch';
            const acquired = await launch(env.BROWSER);
            if (cancelled || attemptFinished) { await acquired.close(); throw new Error('Client disconnected'); }
            browser = acquired;
            for (const capture of batch) {
              if (cancelled || attemptFinished) return;
              activeCapture = capture;
              stage = 'render';
              if (capture !== batch[0]) emit({ type: 'status', message: `Rendering ${capture.timestamp.slice(0, 4)}. ${completed} of ${job.captures.length} previews returned…` });
              let result;
              try {
                const deadline = new Promise((_, reject) => { captureTimer = setTimeout(() => { attemptFinished = true; void close(); reject(new Error('Capture exceeded the 25-second free runtime deadline.')); }, 25000); });
                result = await Promise.race([render(browser, capture), deadline]);
              } catch (error) {
                if (platformFailure(error) || attemptFinished || cancelled) throw error;
                await saveFailure({ ...capture, failureMessage: error.message });
                continue;
              } finally { clearTimeout(captureTimer); }
              if (cancelled || attemptFinished) return;
              stage = 'persist';
              const { png, ...metadata } = result;
              if (!png || png.byteLength > MAX_IMAGE) throw new Error('Screenshot exceeds the 2 MiB free cache limit.');
              const key = captureKey(capture);
              const saved = { ...metadata, text: metadata.text.slice(0, 48000), image: `/cache/${key}.png`, renderVersion: RENDER_VERSION };
              const encoded = JSON.stringify(saved);
              if (new TextEncoder().encode(encoded).byteLength > MAX_JSON) throw new Error('Capture metadata exceeds the free cache limit.');
              await env.CACHE.put(`image:${key}`, png, { expirationTtl: TTL });
              await env.CACHE.put(`capture:${key}`, encoded, { expirationTtl: TTL });
              if (cancelled || attemptFinished) return;
              emit({ type: 'capture', capture: saved, cached: false, completed: ++completed });
            }
            stage = 'close';
            await close();
            if (cancelled || attemptFinished) return;
            emit(completed === job.captures.length ? { type: 'done' } : { type: 'continue', retryAfter: closeConfirmed ? 20 : 90 });
          })();
          await Promise.race([work, timeout]);
        } catch (error) {
          attemptFinished = true;
          const rateLimited = platformFailure(error);
          if (stage === 'render' && !rateLimited && !cancelled) {
            // Unavailable captures must not pin every reconnect to the same date.
            // Keep failures separate from genuine image metadata and retry after TTL.
            await close();
            if (!cancelled) {
              try {
                await saveFailure({ ...activeCapture, failureMessage: error.message });
                emit(completed === job.captures.length ? { type: 'done' } : { type: 'continue', retryAfter: closeConfirmed ? 20 : 90 });
              } catch { emit({ type: 'error', message: 'Could not cache the failed attempt. Retry later; existing previews are kept.', retryAfter: 300 }); }
            }
          } else emit({ type: 'error', message: error.message, retryAfter: rateLimited ? 90 : 300 });
        } finally {
          clearTimeout(timer);
          clearTimeout(captureTimer);
          cancelled = true;
          await close();
          request.signal.removeEventListener('abort', abort);
          try { controller.close(); } catch {}
        }
      },
      async cancel() { cancelled = true; await close(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }

  return async function handle(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'POST' && path === '/api/jobs') return createJob(request, env);
    const eventMatch = path.match(/^\/api\/jobs\/([a-f0-9]{24})\/events$/);
    if (request.method === 'GET' && eventMatch) return env.PREVIEW_MODE === 'html' ? htmlEvents(request, env, eventMatch[1]) : events(request, env, eventMatch[1]);
    const image = path.match(/^\/cache\/([a-f0-9]{24})\.png$/);
    if (['GET', 'HEAD'].includes(request.method) && image) {
      const data = await env.CACHE?.get(`image:${image[1]}`, 'arrayBuffer');
      return data ? new Response(request.method === 'HEAD' ? null : data, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } }) : json(404, { error: 'Preview expired. Search again.' });
    }
    if (path.startsWith('/api/')) return json(404, { error: 'Not found' });
    return env.ASSETS.fetch(request);
  };
}

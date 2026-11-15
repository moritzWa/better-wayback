// Disposable benchmark only. Never mount untrusted HTML on the application origin.
import { launch } from '@cloudflare/playwright';
import { isolatedContext, renderPage } from '../.cache/cloudflare-runtime/renderer.js';
import { quota } from '../cloudflare/quota.js';

const captures = {
  rogo: { timestamp: '20260802001057', original: 'https://rogo.ai/' },
  harvey: { timestamp: '20240102030342', original: 'https://www.harvey.ai/' },
};
const common = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'Server-Timing,X-Archive-Fetch-Ms,X-Text-Parse-Ms,X-Text-Length,X-Rendered-Text,X-Render-Ms' };
const json = (body, status = 200) => Response.json(body, { status, headers: common });

async function getArchive(capture) {
  let url = `https://web.archive.org/web/${capture.timestamp}if_/${capture.original}`;
  const started = Date.now();
  for (let i = 0; i < 4; i++) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (response.status >= 300 && response.status < 400) {
      const next = new URL(response.headers.get('location'), url);
      if (next.origin !== 'https://web.archive.org') throw new Error('Non-archive redirect rejected');
      await response.body?.cancel(); url = next.href; continue;
    }
    if (!response.ok) throw new Error(`Archive HTTP ${response.status}`);
    const html = await response.text();
    if (html.length > 2000000) throw new Error('Benchmark HTML exceeds limit');
    return { html, url, fetchMs: Date.now() - started };
  }
  throw new Error('Too many archive redirects');
}

async function extractText(html) {
  const started = Date.now();
  const removed = new HTMLRewriter()
    .on('script,style,noscript,template,svg,#wm-ipp-base', { element(e) { e.remove(); } })
    .on('h1,h2,h3,h4,h5,h6,p,div,section,article,li,button,nav,header,footer', { element(e) { e.onEndTag(end => end.after(' ')); } })
    .on('br', { element(e) { e.after(' '); } })
    .transform(new Response(html));
  let text = '';
  await new HTMLRewriter().on('body', { text(t) { text += t.text; } }).transform(removed).text();
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  text = text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, entity) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] || all;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
  return { text: text.replace(/\s+/g, ' ').trim(), parseMs: Date.now() - started };
}

async function screenshot(capture, env) {
  const allowance = await quota(env, 'render', { count: 1 });
  if (!allowance.ok) return json(allowance, 429);
  const start = Date.now();
  let browser, context, confirmed = false;
  const timer = setTimeout(() => { void browser?.close().catch(() => {}); }, 25000);
  try {
    browser = await launch(env.BROWSER);
    context = await isolatedContext(browser);
    const page = await context.newPage();
    const result = await renderPage(page, capture, undefined, { readinessTimeoutMs: 8000 });
    return new Response(result.png, { headers: { ...common, 'Content-Type': 'image/png', 'X-Render-Ms': String(Date.now() - start), 'X-Rendered-Text': encodeURIComponent(result.text) } });
  } finally {
    clearTimeout(timer);
    await context?.close().catch(() => {});
    if (browser) { try { await browser.close(); confirmed = true; } catch {} }
    if (confirmed) await quota(env, 'release', { token: allowance.token });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), capture = captures[url.searchParams.get('id')];
    if (request.method !== 'GET' || !capture) return json({ error: 'Unknown benchmark capture' }, 404);
    try {
      if (url.pathname === '/shot') return await screenshot(capture, env);
      if (!['/proxy', '/text'].includes(url.pathname)) return json({ error: 'Unknown route' }, 404);
      const source = await getArchive(capture), extracted = await extractText(source.html);
      if (url.pathname === '/text') return json({ ...extracted, fetchMs: source.fetchMs, htmlBytes: source.html.length });
      const html = new HTMLRewriter().on('head', { element(e) { e.prepend(`<base href="${source.url}">`, { html: true }); } }).transform(new Response(source.html));
      return new Response(html.body, { headers: { ...common, 'Content-Type': 'text/html; charset=utf-8', 'X-Archive-Fetch-Ms': String(source.fetchMs), 'X-Text-Parse-Ms': String(extracted.parseMs), 'X-Text-Length': String(extracted.text.length), 'Content-Security-Policy': "sandbox allow-scripts allow-same-origin; default-src https://web.archive.org https://web-static.archive.org data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src https://web.archive.org; object-src 'none'; base-uri https://web.archive.org" } });
    } catch (error) { return json({ error: error.message }, 502); }
  },
};

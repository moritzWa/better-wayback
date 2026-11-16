import { normalizeUrl, keyFor, RENDER_VERSION } from '../lib.js';
import { HTML_VERSION } from './html.js';
import { exampleForSite } from '../public/examples.js';

export const timelineId = (url, from, to, count, html) => keyFor(JSON.stringify([url, from, to, count, RENDER_VERSION, ...(html ? [HTML_VERSION] : [])]));
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Unfurlers only read existing assets/cache. Never fetch an arbitrary target,
// query the archive or start a browser on a crawler's GET request.
export async function socialPage(request, env, cached) {
  const incoming = new URL(request.url);
  if (incoming.pathname !== '/' || !incoming.searchParams.has('url') || !['GET', 'HEAD'].includes(request.method)) return null;
  let url;
  try { url = normalizeUrl(incoming.searchParams.get('url')); } catch { return null; }
  const from = incoming.searchParams.get('from') || '';
  const to = incoming.searchParams.get('to') || String(new Date().getUTCFullYear());
  const count = [8, 16, 24].includes(Number(incoming.searchParams.get('count'))) ? Number(incoming.searchParams.get('count')) : 8;
  if ((from && (!/^\d{4}$/.test(from) || +from < 1996 || from > to)) || !/^\d{4}$/.test(to) || +to < 1996 || +to > new Date().getUTCFullYear()) return null;
  const canonical = new URL('https://visualwayback.com/');
  canonical.searchParams.set('url', url);
  for (const [key, value] of [['from', from], ['to', incoming.searchParams.get('to')], ['count', count !== 8 ? String(count) : '']]) if (value) canonical.searchParams.set(key, value);
  let capture;
  try {
    const example = !from && !incoming.searchParams.get('to') && count === 8 && exampleForSite(url);
    if (example) {
      const response = await env.ASSETS.fetch(new Request(`https://visualwayback.com/api/demos/${example.id}`));
      if (response.ok) capture = (await response.json()).captures?.filter(c => c.sourceType !== 'live' && c.image).at(-1);
    } else {
      const id = timelineId(url, from, to, count, env.PREVIEW_MODE === 'html');
      const saved = await env.CACHE?.get(`social:${id}`, 'json');
      if (saved) capture = await cached(env, saved, true);
      if (!capture) {
        const job = await env.CACHE?.get(`job:${id}`, 'json');
        for (const candidate of [...(job?.captures || [])].reverse()) {
          capture = await cached(env, candidate, true);
          if (capture) break;
        }
      }
    }
  } catch { /* Cache trouble must not take down a shared search. */ }
  const label = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const title = `${label} · Visual Wayback`;
  const description = `Explore the visual history of ${label}. Compare archived versions and see how the site changed.`;
  const image = capture?.image && /^\/(?:cache\/[a-f0-9]{24}\.png|demos\/[a-z0-9/_-]+\.png)$/.test(capture.image) ? `https://visualwayback.com${capture.image}` : 'https://visualwayback.com/icon-512.png';
  const alt = capture?.timestamp ? `${label}, archived ${capture.timestamp.slice(0, 4)}-${capture.timestamp.slice(4, 6)}-${capture.timestamp.slice(6, 8)}` : 'Visual Wayback';
  // Do not forward conditional/range headers for the generic asset: its ETag
  // does not describe this query-specific document.
  const source = await env.ASSETS.fetch(new Request(new URL('/', request.url)));
  if (!source.ok) return source;
  let html = await source.text();
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${escape(canonical.href)}">`)
    .replace(/<meta (?:property="og:[^"]*"|name="(?:description|twitter:[^"]*)")[^>]*>\s*/g, '');
  const tags = { 'og:title': title, 'og:description': description, 'og:type': 'website', 'og:url': canonical.href, 'og:image': image, 'og:image:type': 'image/png', 'og:image:alt': alt };
  const metadata = Object.entries(tags).map(([name, value]) => `<meta property="${name}" content="${escape(value)}">`).join('\n');
  html = html.replace('</head>', `<meta name="description" content="${escape(description)}">\n${metadata}\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${escape(title)}">\n<meta name="twitter:description" content="${escape(description)}">\n<meta name="twitter:image" content="${escape(image)}">\n</head>`);
  const headers = new Headers(source.headers);
  for (const name of ['content-length', 'content-encoding', 'etag', 'last-modified']) headers.delete(name);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  // A cold logo must not pin the page's preview after screenshots arrive.
  headers.set('Cache-Control', capture ? 'public, max-age=60' : 'no-store');
  return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers });
}

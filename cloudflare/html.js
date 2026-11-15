export const HTML_VERSION = 'html-v1';
export const MAX_HTML = 1024 * 1024;

export function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, value) => {
    if (value[0] !== '#') return named[value.toLowerCase()] || all;
    const code = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : parseInt(value.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : all;
  });
}

export function normalizeHtmlText(input) {
  const seen = new Set();
  const lines = decodeEntities(input).normalize('NFKC').split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(line => {
    if (!line || seen.has(line)) return false;
    seen.add(line); return true;
  });
  const text = lines.join('\n');
  return { text: text.slice(0, 12000), textTruncated: text.length > 12000 };
}

// Cloudflare's native streaming parser. Archived scripts are removed, never run.
export async function extractHtml(html) {
  let title = '', text = '';
  const source = new HTMLRewriter()
    .on('title', { text(chunk) { if (title.length < 1000) title += chunk.text; } })
    .on('script,style,noscript,template,svg,[hidden],[aria-hidden="true"],#wm-ipp-base,#donato', { element(e) { e.remove(); } })
    .on('h1,h2,h3,h4,h5,h6,p,div,section,article,li,button,nav,header,footer', { element(e) { e.onEndTag(end => end.after('\n')); } })
    .on('br', { element(e) { e.after('\n'); } })
    .transform(new Response(html));
  await new HTMLRewriter().on('body', { text(chunk) { text += chunk.text; } }).transform(source).text();
  const normalized = normalizeHtmlText(text);
  return { ...normalized, title: decodeEntities(title).replace(/\s+/g, ' ').trim().slice(0, 300), comparisonUnavailable: normalized.text.length < 40 || normalized.textTruncated };
}

export function iframeUrl(capture) {
  return `https://web.archive.org/web/${capture.requestedTimestamp || capture.timestamp}if_/${capture.original}`;
}

export function archiveHtmlAllowed(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && url.hostname === 'web.archive.org' && !url.port && !url.username && !url.password && /^\/web\/\d{14}(?:id_|if_)?\/https?:\/\//.test(url.pathname);
  } catch { return false; }
}

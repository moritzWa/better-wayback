import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { articles } from './content/articles.js';

export const BLOG_ORIGIN = 'https://visualwayback.com';
const BRAND = 'Visual Wayback';
const html = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const json = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
const articlePath = article => `/blog/${article.slug}/`;
const dateLabel = date => new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const scripts = new Set();

// Deliberately small inline format: links only. All other input remains escaped text.
function inline(text) {
  let result = '', offset = 0;
  for (const match of String(text).matchAll(/\[([^\]\n]+)\]\(([^\s)]+)\)/g)) {
    result += html(text.slice(offset, match.index));
    const [, label, href] = match;
    const safe = /^https:\/\//.test(href) || /^\/(?!\/)[a-z0-9/_#.-]*$/i.test(href);
    result += safe ? `<a href="${html(href)}">${html(label)}</a>` : html(match[0]);
    offset = match.index + match[0].length;
  }
  return result + html(text.slice(offset));
}

function block(value) {
  if (value.type === 'p') return `<p>${inline(value.text)}</p>`;
  if (value.type === 'h2') return `<h2 id="${html(value.id)}">${html(value.text)}</h2>`;
  if (value.type === 'ul') return `<ul>${value.items.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`;
  if (value.type === 'table') return `<div class="table-scroll" role="region" aria-label="${html(value.caption)}" tabindex="0"><table><caption>${html(value.caption)}</caption><thead><tr>${value.headings.map(heading => `<th scope="col">${html(heading)}</th>`).join('')}</tr></thead><tbody>${value.rows.map(row => `<tr>${row.map((cell, index) => `<${index ? 'td' : 'th scope="row"'}>${inline(cell)}</${index ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  throw new Error(`Unknown blog block: ${value.type}`);
}

function structuredData(value) {
  const body = json(value);
  scripts.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  return `<script type="application/ld+json">${body}</script>`;
}

function page({ title, description, path, content, schema, article, noindex = false }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(title)} | ${html(BRAND)}</title>
<meta name="description" content="${html(description)}">
${noindex ? '<meta name="robots" content="noindex, follow">' : `<link rel="canonical" href="${html(BLOG_ORIGIN + path)}">`}
<meta property="og:type" content="${article ? 'article' : 'website'}">
<meta property="og:site_name" content="${html(BRAND)}">
<meta property="og:title" content="${html(title)}">
<meta property="og:description" content="${html(description)}">
<meta property="og:url" content="${html(BLOG_ORIGIN + path)}">
<meta name="twitter:card" content="summary">
${article ? `<meta property="article:published_time" content="${html(article.published)}"><meta property="article:modified_time" content="${html(article.modified)}">` : ''}
<link rel="stylesheet" href="/blog/style.css">
${schema ? structuredData(schema) : ''}
</head><body><a class="skip" href="#main">Skip to content</a><div class="page">
<header class="site-header"><a class="brand" href="/">${html(BRAND)}</a><nav aria-label="Main"><a href="/">Home</a><a href="/blog/"${path === '/blog/' ? ' aria-current="page"' : ''}>Blog</a></nav></header>
<main id="main">${content}</main>
<footer><span>Not affiliated with the Internet Archive.</span><div class="footer-links"><a href="https://moritzw.com/">Built by Moritz Wallawitsch</a><a href="https://github.com/moritzWa/better-wayback">GitHub</a><a href="/blog/">All articles</a></div></footer>
</div></body></html>`;
}

function renderArticle(article) {
  const path = articlePath(article);
  const headings = article.blocks.filter(item => item.type === 'h2');
  const words = article.blocks.map(item => item.text || item.items?.join(' ') || item.rows?.flat().join(' ') || '').join(' ').split(/\s+/).length;
  const schema = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: article.title, description: article.description,
    datePublished: article.published, dateModified: article.modified,
    author: { '@type': 'Organization', name: BRAND, url: `${BLOG_ORIGIN}/` },
    publisher: { '@type': 'Organization', name: BRAND, url: `${BLOG_ORIGIN}/` },
    mainEntityOfPage: { '@type': 'WebPage', '@id': BLOG_ORIGIN + path },
    url: BLOG_ORIGIN + path, inLanguage: 'en', articleSection: article.category,
    citation: article.sources.map(source => source.url),
  };
  const content = `<article>
<div class="label">${html(article.category)}</div><h1>${html(article.title)}</h1>
<p class="lede">${html(article.summary)}</p>
<p class="byline">By ${html(BRAND)} · Published <time datetime="${html(article.published)}">${html(dateLabel(article.published))}</time> · ${Math.ceil(words / 220)} min read</p>
<p class="method">${html(article.methodology)}</p>
<nav class="contents" aria-label="In this article"><h2>In this article</h2><ul>${headings.map(heading => `<li><a href="#${html(heading.id)}">${html(heading.text)}</a></li>`).join('')}<li><a href="#sources">Sources and research notes</a></li></ul></nav>
<div class="prose">${article.blocks.map(block).join('\n')}</div>
<section class="sources" aria-labelledby="sources"><h2 id="sources">Sources and research notes</h2><p>Links identify the material used for this article. Access dates record this review, not the source’s publication date.</p><ol>${article.sources.map(source => `<li><a href="${html(source.url)}">${html(source.title)}</a><p>${html(source.note)} Accessed <time datetime="${html(source.accessed)}">${html(dateLabel(source.accessed))}</time>.</p></li>`).join('')}</ol></section>
<aside class="related" aria-label="Related reading"><div class="label">Related reading</div>${articles.filter(other => other.slug !== article.slug).map(other => `<a href="${html(articlePath(other))}">${html(other.title)}</a>`).join('')}</aside>
</article>`;
  return page({ title: article.title, description: article.description, path, schema, content, article });
}

const index = page({
  title: 'Web history and archiving guides',
  description: 'Researched guides to the Wayback Machine, web archiving alternatives, historical website discovery and preserving pages.',
  path: '/blog/',
  content: `<div class="label">The blog</div><h1>Understand the web’s past.</h1><p class="lede">Two researched guides to finding old pages, preserving new ones and reading web history carefully.</p><div class="article-list">${articles.map(article => `<article><div class="label">${html(article.category)}</div><h2><a href="${html(articlePath(article))}">${html(article.title)}</a></h2><p>${html(article.summary)}</p><p class="byline"><time datetime="${html(article.published)}">${html(dateLabel(article.published))}</time> · Sources and research notes included</p></article>`).join('')}</div>`,
});
const rendered = new Map(articles.map(article => [articlePath(article), renderArticle(article)]));
const css = readFileSync(new URL('./content/style.css', import.meta.url), 'utf8');
const notFound = page({ title: 'Article not found', description: 'This article could not be found.', path: '/blog/', noindex: true, content: '<h1>Article not found.</h1><p>Browse the <a href="/blog/">web history and archiving guides</a>.</p>' });

// Ready-to-append CSP hash sources for the exact inert JSON-LD blocks above.
// No executable script, inline style, external font or external asset is required.
export const blogScriptHashes = Object.freeze([...scripts]);
export const blogSitemapEntries = Object.freeze([
  Object.freeze({ path: '/blog/' }),
  ...articles.map(article => Object.freeze({ path: articlePath(article), lastmod: article.modified })),
]);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${html(BLOG_ORIGIN)}/</loc></url>${blogSitemapEntries.map(entry => `<url><loc>${html(BLOG_ORIGIN + entry.path)}</loc>${entry.lastmod ? `<lastmod>${html(entry.lastmod)}</lastmod>` : ''}</url>`).join('')}</urlset>\n`;

/**
 * Synchronous, side-effect-free request handler. Pass a URL pathname (not a file path).
 * Returns { status, contentType, body }, or null for routes outside this module.
 * Caller owns HTTP method handling, response headers, HEAD suppression and CSP.
 */
export function handleBlogRequest(path) {
  if (typeof path !== 'string') return null;
  if (path === '/robots.txt') return { status: 200, contentType: 'text/plain; charset=utf-8', body: `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${BLOG_ORIGIN}/sitemap.xml\n` };
  if (path === '/sitemap.xml') return { status: 200, contentType: 'application/xml; charset=utf-8', body: sitemap };
  if (path === '/blog/style.css') return { status: 200, contentType: 'text/css; charset=utf-8', body: css };
  if (path === '/blog' || path === '/blog/') return { status: 200, contentType: 'text/html; charset=utf-8', body: index };
  const article = rendered.get(path.endsWith('/') ? path : path + '/');
  if (article) return { status: 200, contentType: 'text/html; charset=utf-8', body: article };
  if (path.startsWith('/blog/')) return { status: 404, contentType: 'text/html; charset=utf-8', body: notFound };
  return null;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleBlogRequest, blogScriptHashes, blogSitemapEntries, BLOG_ORIGIN } from '../blog.js';
import { articles } from './articles.js';

const articlePaths = articles.map(article => `/blog/${article.slug}/`);

test('serves only the blog and the two discovery endpoints', () => {
  for (const path of ['/blog/', '/blog', ...articlePaths, '/blog/style.css', '/sitemap.xml', '/robots.txt']) {
    const response = handleBlogRequest(path);
    assert.equal(response.status, 200, path);
    assert.ok(response.body.length > 0);
    assert.match(response.contentType, /charset=utf-8/);
  }
  for (const path of ['/', '/api/jobs', '/public/style.css', '/blogs/', '', null, undefined]) assert.equal(handleBlogRequest(path), null);
  assert.equal(handleBlogRequest('/blog/missing/').status, 404);
  assert.match(handleBlogRequest('/blog/<img src=x>/').body, /noindex, follow/);
  assert.doesNotMatch(handleBlogRequest('/blog/<img src=x>/').body, /<img/);
});

test('articles are substantive, dated, sourced and fully static', () => {
  for (const [index, path] of articlePaths.entries()) {
    const article = articles[index], body = handleBlogRequest(path).body;
    assert.equal((body.match(/<h1>/g) || []).length, 1);
    assert.match(body, /<html lang="en">/);
    assert.match(body, /rel="stylesheet" href="\/blog\/style.css"/);
    assert.ok(body.includes(`<link rel="canonical" href="${BLOG_ORIGIN}${path}">`));
    assert.ok(article.blocks.filter(block => block.type === 'p').map(block => block.text).join(' ').split(/\s+/).length > 1500);
    assert.ok(article.sources.length >= 8);
    assert.ok(article.published <= new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
    assert.equal(article.modified, article.published);
    assert.doesNotMatch(body, /\u2014|<style|style=|<iframe|<script src=/);
    assert.equal(handleBlogRequest(path.slice(0, -1)).body, body);
    for (const source of article.sources) {
      assert.equal(source.accessed, '2026-11-14');
      assert.ok(body.includes(source.url));
    }
  }
});

test('JSON-LD is valid, agrees with canonical metadata and has precise CSP hashes', () => {
  const actualHashes = [];
  for (const [index, path] of articlePaths.entries()) {
    const body = handleBlogRequest(path).body;
    const match = body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(match);
    const data = JSON.parse(match[1]);
    assert.equal(data['@type'], 'Article');
    assert.equal(data.headline, articles[index].title);
    assert.equal(data.url, BLOG_ORIGIN + path);
    assert.equal(data.mainEntityOfPage['@id'], data.url);
    assert.equal(data.datePublished, articles[index].published);
    assert.deepEqual(data.citation, articles[index].sources.map(source => source.url));
    actualHashes.push(`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  }
  assert.deepEqual([...blogScriptHashes].sort(), actualHashes.sort());
});

test('all local article links, anchors and sitemap targets resolve', () => {
  for (const path of ['/blog/', ...articlePaths]) {
    const body = handleBlogRequest(path).body;
    const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size);
    for (const [, href] of body.matchAll(/href="([^"]+)"/g)) {
      if (href.startsWith('#')) assert.ok(ids.includes(href.slice(1)), `${path}: ${href}`);
      else if (href.startsWith('/') && href !== '/') assert.equal(handleBlogRequest(href)?.status, 200, href);
    }
  }
  const sitemap = handleBlogRequest('/sitemap.xml').body;
  for (const entry of blogSitemapEntries) assert.ok(sitemap.includes(`<loc>${BLOG_ORIGIN}${entry.path}</loc>`));
  assert.equal((sitemap.match(/<url>/g) || []).length, 4);
  assert.ok(handleBlogRequest('/robots.txt').body.includes(`Sitemap: ${BLOG_ORIGIN}/sitemap.xml`));
});

test('metadata, inline content, tables and JSON-LD escape hostile text', async () => {
  const article = articles[0];
  const originalTitle = article.title;
  const payload = '</script><img src=x onerror="alert(1)">&\u2028\u2029';
  article.title = payload;
  article.blocks.push({ type: 'p', text: `${payload} [unsafe](javascript:alert) [protocol-relative](//evil.example) [good](https://example.com/?a=1&b=2)` });
  article.blocks.push({ type: 'table', caption: payload, headings: [payload], rows: [[payload]] });
  try {
    const fresh = await import(`../blog.js?escape-test=${Date.now()}`);
    const body = fresh.handleBlogRequest(articlePaths[0]).body;
    assert.doesNotMatch(body, /<img|href="javascript:|href="\/\/evil/);
    assert.ok(body.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
    assert.ok(body.includes('href="https://example.com/?a=1&amp;b=2"'));
    const data = body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    assert.equal(JSON.parse(data).headline, payload);
    assert.doesNotMatch(data, /[<>&\u2028\u2029]/);
  } finally {
    article.title = originalTitle;
    article.blocks.splice(-2);
  }
});

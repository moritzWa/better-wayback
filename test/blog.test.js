import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleBlogRequest } from '../blog.js';

test('blog routes provide index, two sourced articles, stylesheet, sitemap, and robots', () => {
  assert.equal(handleBlogRequest('/not-a-blog-route'), null);
  const index = handleBlogRequest('/blog/');
  assert.equal(index.status, 200);
  assert.match(index.contentType, /text\/html/);
  assert.match(index.body, /<h1[\s>]/);
  const slugs = [...new Set([...index.body.matchAll(/href="(\/blog\/[^"?#]+\/)"/g)].map(m => m[1]))];
  assert.equal(slugs.length, 2, 'exactly two substantive launch articles');
  for (const slug of slugs) {
    const article = handleBlogRequest(slug);
    assert.equal(article.status, 200, slug);
    assert.match(article.body, /<meta[^>]+name="description"/);
    assert.ok(article.body.includes(`https://betterwaybackmachine.com${slug}`));
    assert.match(article.body, /application\/ld\+json/);
    assert.match(article.body, /sources|references/i);
    assert.ok([...article.body.matchAll(/href="https?:\/\//g)].length >= 6, 'multiple linked sources');
    const text = article.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(text.split(' ').length >= 1200, 'a substantive article, not thin SEO filler');
    assert.equal(article.body.includes('—'), false, 'no em-dashes in prose');
  }
  const css = handleBlogRequest('/blog/style.css');
  assert.equal(css.status, 200);
  assert.match(css.contentType, /text\/css/);
  const sitemap = handleBlogRequest('/sitemap.xml');
  assert.equal(sitemap.status, 200);
  for (const slug of slugs) assert.ok(sitemap.body.includes(slug));
  assert.match(handleBlogRequest('/robots.txt').body, /Sitemap: https:\/\/betterwaybackmachine\.com\/sitemap\.xml/);
});

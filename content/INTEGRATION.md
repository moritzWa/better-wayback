# Blog integration

Owned files: `blog.js` and `content/`. No runtime dependency added.

```js
import { handleBlogRequest, blogScriptHashes } from './blog.js';

// Within the existing server handler, before its static-file fallback:
if (req.method === 'GET' || req.method === 'HEAD') {
  const blog = handleBlogRequest(new URL(req.url, 'http://localhost').pathname);
  if (blog) {
    res.writeHead(blog.status, {
      'Content-Type': blog.contentType,
      'X-Content-Type-Options': 'nosniff',
      // Or append blogScriptHashes to your existing script-src directive.
      'Content-Security-Policy': `default-src 'none'; style-src 'self'; script-src ${blogScriptHashes.join(' ')}; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    });
    res.end(req.method === 'HEAD' ? undefined : blog.body);
    return;
  }
}
```

## Contract

`handleBlogRequest(pathname)` is synchronous. It returns `{ status, contentType, body }` or `null` when a path is outside its scope. `body` is a UTF-8 string. Pass only the URL pathname, not a raw request URL with query parameters. GET and HEAD handling belong to the server. Non-GET methods must not reach a successful blog response.

- `/blog/` (also `/blog`): article index.
- `/blog/wayback-machine-alternatives/`: comparison.
- `/blog/history-of-the-wayback-machine/`: history.
- Article paths without the final slash render the same page; canonical URLs include the slash.
- `/blog/style.css`: stylesheet, served from the module rather than public files.
- Unknown `/blog/…`: escaped generic 404 page with `noindex, follow`.
- `/sitemap.xml`: homepage, blog index and both articles. No invented homepage last-modified date.
- `/robots.txt`: allow public pages, disallow `/api/`, name the canonical sitemap.
- All other paths return `null`.

`blogSitemapEntries` also exports frozen `{ path, lastmod? }` entries for merging into a larger sitemap if needed. Do not serve two conflicting sitemap or robots handlers. The root sitemap includes `/` separately.

## CSP and assets

All HTML is rendered on module load. No client-side executable JS, inline CSS, external assets, fonts, cookies or network requests are needed. The only script elements contain Article JSON-LD. `blogScriptHashes` exports exact quoted SHA-256 CSP sources for those blocks. Use those hashes if the deployment's CSP requires explicit permission for structured data. Do not enable `unsafe-inline` to accommodate them. The hashes are recomputed from the actual emitted content when the server starts.

Both static articles and metadata escape HTML. JSON-LD separately escapes `<`, `>`, `&` and Unicode line/paragraph separators, including script-closing strings. The content format does not accept raw HTML. Inline links permit HTTPS or local root-relative paths only. Request paths are never reflected into HTML or read from disk.

## Editorial and domain status

Canonical/OG/schema/sitemap origin: `https://betterwaybackmachine.com`. This is the requested target domain, not a claim it is purchased, live or configured. No deployment or purchase is part of this module.

The local clock was checked on November 14, 2026 in America/New_York before setting article dates. Both articles were prepared that day. The visible methodology and source notes disclose documentation-based research, the publisher's interest in Better Wayback and limits on verification. No interviews were conducted for these articles.

Better Wayback claims deliberately stop at a sampled interface to the Internet Archive, rendered-text grouping and screenshot previews. They do not promise independent archival coverage, visual-diff detection, continuous monitoring or every-change discovery. The prototype has no account/billing system; no hosted price is invented.

## Checks

Run the module checks with `python3 ~/.claude/scripts/heavy-job.py --wait -- node --test content/blog.test.js` on this machine. They are lightweight Node assertions, not a browser test or full project suite, but the local guard requires test commands to use the shared queue. `node content/check-links.js` checks the finite set of cited external URLs using GET, follows redirects and reports access failures without treating them as broken links automatically. It does not capture web pages or run Playwright.

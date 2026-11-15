# Better Wayback

A visual Wayback Machine timeline that folds consecutive captures with similar rendered text. Independent prototype, not affiliated with the Internet Archive.

## Run

Requires Node 22+ and Chromium for Playwright.

```sh
npm install
npx playwright install chromium
npm start
```

Open http://localhost:4317. Rendering uses the optional local resource queue when installed; otherwise it runs directly. At most two archived pages render concurrently.

## What works

- Public CDX capture lookup, successful-response filtering, adjacent HTML digest deduplication.
- 8, 16, or 24 chronological samples with both endpoints included.
- Headless archived-page replay, rendered text extraction, screenshot previews.
- Progressive results, screenshot/text disk cache, text-similarity grouping and adjustable threshold.
- Two concurrent renders, 24-hour CDX cache, cached previews first, stable chronological preview DOM.
- Readiness checks for delayed CSS/JavaScript reveals, fonts, visible images and stable content. Animations are not cancelled before screenshots.
- Changes-only/all-sampled views and before/after text comparison.
- Mobile layout, explicit partial-history warnings, failed captures visible in all-sampled view.
- Archived browser traffic is restricted to HTTPS web.archive.org, with WebSockets blocked. Chromium's OS sandbox is explicitly enabled, with separate browser contexts. No live-site fallback; archived HTML is never embedded into the application origin.
- Minimal design matching agent-view.app, plus a static blog with researched alternatives and history articles, source notes, metadata, JSON-LD, sitemap and robots routes.

## Limits

This is a **sampled** history, not a claim to find every change. Initial CDX lookup is capped at 1,200 digest-distinct entries. If that cap is hit, a second query gets one candidate per month across the requested span, so recent years aren't lost. The UI identifies this fallback and shows the indexed count as a lower bound. A later version should paginate the complete index and adaptively sample around transitions.

Grouping compares rendered text, not layout or image pixels. A redesign with unchanged text can be folded. Similarity uses word-trigram overlap, not semantic understanding. Clock times and whitespace are normalized, but dates, ads, ordering, and minor dynamic text can still produce false changes. Comparison highlights lines absent from the other version; it is not a sequence-aligned diff.

Captured API responses may replay, but missing responses or resources can make captures incomplete. The visible archive toolbar is removed before extraction. Pages use a fixed 1280×800 viewport. Capture date is not launch date. Redirected replay timestamps are recorded rather than silently showing the originally requested date.

One analysis runs at a time, with a 15-minute deadline. Completed jobs and rendered captures are cached on disk; interrupted event streams aren't resumed across a restart. No accounts, billing, or visual-diff mode yet.

A correct uncached animated page can take longer than an incomplete screenshot. The exact February 18, 2024 Harvey capture now shows its full hero in 6.726 seconds, compared with the old incomplete capture at 3.318 seconds. Two-page throughput on the same recorded archive was 1.98× sequential throughput; this is not a network latency guarantee. Reproduction and evidence: `test/evidence/harvey-renderer/README.md`.

## Tests

```sh
npm test
# With server running:
npm run test:ui
```

UI tests use clearly marked deterministic fixtures via network interception. Real capture rendering is checked separately against Internet Archive, not represented by the test fixture screenshots.

Optional real-network end-to-end check (with server running): `node test/live.js`. This checks Stripe's 2012–2026 history, real screenshots, text comparison, and mobile overflow. Use `BETTER_WAYBACK_TEST_URL=http://localhost:4317 npm test` to include API validation/security tests.

For the full suite including renderer browser checks and blog module checks:

```sh
RENDERER_BROWSER_TESTS=1 BETTER_WAYBACK_TEST_URL=http://localhost:4317 node --test test/api.test.js test/blog.test.js test/lib.test.js test/renderer.test.js test/renderer-api.test.js content/blog.test.js
node test/site.js
```

The site test checks real HTTP blog routing, metadata, JSON-LD, CSP, HEAD responses, sitemap, missing articles and responsive layouts. Article source checking and access restrictions are documented in `content/RESEARCH.md`.

## License and credits

Built by [Moritz Wallawitsch](https://moritzw.com/). The application source is available under the [MIT License](LICENSE). Historical screenshots and archived page content belong to their respective owners and are not relicensed by this project. Captures come from the [Internet Archive](https://archive.org/); this project is independent and not affiliated with it.

Canonical URLs target `https://betterwaybackmachine.com`. Running the prototype locally does not imply that the public domain is deployed.

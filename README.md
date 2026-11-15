# Visual Wayback

A visual Wayback Machine timeline that folds consecutive captures with similar text. Independent prototype, not affiliated with the Internet Archive.

## Public hosting

The public site runs on Cloudflare Workers Free. New searches fetch and compare archived HTML on the server while the visitor's browser renders direct Wayback replays. Existing genuine screenshot caches and the packaged examples remain available. Normal public searches no longer launch a server browser or use the Browser Run quota. The app never upgrades the plan or charges visitors.

The edge runtime publishes preview links before HTML comparisons finish. It reads at most two archived HTML pages concurrently, eight per connected request, with one-second continuation between batches. HTML metadata is cached separately for seven days. At most two live iframe documents are active near the viewport; scrolling away or starting another search unloads them. Live timelines can be incomplete when the archive is unavailable or the free cache quota is exhausted.

Grouping never treats missing, truncated or pending text as unchanged. HTML and rendered-text sources are not compared to each other. JavaScript-only text can be missing from HTML, and identical responsive text blocks are deduplicated. Preview status reports iframe navigation, not a guarantee that every archived asset rendered correctly.

Submitted searches update the address bar, for example `/?url=rogo.ai`. Links preserve date/sample settings, reload the same search, and work with Back/Forward. Typing alone does not start archive jobs.

Deployment, quotas and verification are documented in [the Cloudflare deployment guide](docs/cloudflare-deployment.md). The [support link](SUPPORT.md) reveals a server-held email only after a click and Turnstile verification. This deters simple scraping, not bots that complete the challenge.

## Run

Requires Node 22+ and Chromium for Playwright. This local server retains the original screenshot workflow; the public Cloudflare runtime uses the HTML-first path described above.

```sh
npm install
npx playwright install chromium
npm start
```

Open http://localhost:4317. Rendering uses the optional local resource queue when installed; otherwise it runs directly. At most two archived pages render concurrently.

The homepage opens a packaged Stripe example immediately. Stripe and Amazon examples use checked-in screenshot and text data, not a live browser or an Internet Archive request. Custom searches still query and render the archive.

The examples are curated, not complete histories: four Stripe captures from 2012–2026 and six Amazon captures from 1999–2019. Unavailable rendering attempts are disclosed. Archived assets may be incomplete even in successful captures.

## What works

- Public CDX capture lookup, successful-response filtering, adjacent HTML digest deduplication.
- 8, 16, or 24 chronological samples with both endpoints included.
- Headless archived-page replay, rendered text extraction, screenshot previews.
- Progressive results, screenshot/text disk cache, text-similarity grouping and adjustable threshold.
- Two concurrent renders, 24-hour CDX cache, cached previews first, stable chronological preview DOM.
- Readiness checks for delayed CSS/JavaScript reveals, fonts, visible images and stable content. Animations are not cancelled before screenshots.
- Changes-only/all-sampled views and before/after text comparison.
- Mobile layout, explicit partial-history warnings, and failed captures visible in both timeline views.
- Pending capture skeletons and unavailable cards remain visible while a search runs, including in the grouped view. Grouping, sample count and automatic date bounds live in Settings.
- The optional server screenshot renderer restricts traffic to HTTPS web.archive.org and blocks WebSockets, with Chromium's OS sandbox and separate contexts. Live client iframes are cross-origin and sandboxed, with no forms, popups, downloads or top navigation. The app never uses srcdoc or serves archived scripts on its own origin. The archive's own policy governs iframe subresource traffic; it is not the server renderer's stricter network sandbox.
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
node test/html-ui.js
```

The site test checks real HTTP blog routing, metadata, JSON-LD, CSP, HEAD responses, sitemap, missing articles and responsive layouts. Article source checking and access restrictions are documented in `content/RESEARCH.md`.

## Refreshing the examples

```sh
node tools/precache-demos.js stripe --cached-only
node tools/precache-demos.js amazon --cached-only
```

Omit `--cached-only` to capture missing previews from the Internet Archive. Network refreshes use sandboxed Chromium, run one archived page at a time and stop on upstream throttling. If you use a local heavy-job queue, run the refresh through that queue. Example manifests live in `demos/`, and screenshot files in `public/demos/`. Runtime example requests only read those packaged files.

Future article briefs are in [the editorial plan](docs/editorial-plan.md).

## License and credits

Built by [Moritz Wallawitsch](https://moritzw.com/). The application source is available under the [MIT License](LICENSE). Historical screenshots and archived page content belong to their respective owners and are not relicensed by this project. Captures come from the [Internet Archive](https://archive.org/); this project is independent and not affiliated with it.

Canonical URLs target `https://visualwayback.com`, registered November 15, 2026 through November 15, 2027. The repository keeps its original `better-wayback` name so existing source links continue to work.

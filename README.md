# Better Wayback

A visual Wayback Machine timeline that folds consecutive captures with similar rendered text. Independent prototype, not affiliated with the Internet Archive.

## Run

Requires Node 22+ and Chromium for Playwright.

```sh
npm install
npx playwright install chromium
npm start
```

Open http://localhost:4317. By default rendering goes through Moritz's local `~/.claude/scripts/heavy-job.py --wait` resource queue. On another machine, use `BETTER_WAYBACK_NO_QUEUE=1 npm start`.

## What works

- Public CDX capture lookup, successful-response filtering, adjacent HTML digest deduplication.
- 8, 16, or 24 chronological samples with both endpoints included.
- Headless archived-page replay, rendered text extraction, screenshot previews.
- Progressive results, screenshot/text disk cache, text-similarity grouping and adjustable threshold.
- Changes-only/all-sampled views and before/after text comparison.
- Mobile layout, explicit partial-history warnings, failed captures visible in all-sampled view.
- Archived browser traffic is restricted to HTTPS web.archive.org. No live-site fallback. Untrusted content is rendered in isolated browser contexts, never embedded into the application origin.

## Limits

This is a **sampled** history, not a claim to find every change. Initial CDX lookup is capped at 1,200 digest-distinct entries. If that cap is hit, a second query gets one candidate per month across the requested span, so recent years aren't lost. The UI identifies this fallback and shows the indexed count as a lower bound. A later version should paginate the complete index and adaptively sample around transitions.

Grouping compares rendered text, not layout or image pixels. A redesign with unchanged text can be folded. Similarity uses word-trigram overlap, not semantic understanding. Clock times and whitespace are normalized, but dates, ads, ordering, and minor dynamic text can still produce false changes. Comparison highlights lines absent from the other version; it is not a sequence-aligned diff.

Captured API responses may replay, but missing responses or resources can make captures incomplete. The visible archive toolbar is removed before extraction. Pages use a fixed 1280×800 viewport. Capture date is not launch date. Redirected replay timestamps are recorded rather than silently showing the originally requested date.

One analysis runs at a time, with a 15-minute deadline. Completed jobs and rendered captures are cached on disk; interrupted event streams aren't resumed across a restart. No accounts, billing, hosted backend, domain purchase, or visual-diff mode yet.

## Tests

```sh
npm test
# With server running; renders a browser, run through the resource queue:
python3 ~/.claude/scripts/heavy-job.py --wait -- npm run test:ui
```

UI tests use clearly marked deterministic fixtures via network interception. Real capture rendering is checked separately against Internet Archive, not represented by the test fixture screenshots.

## Domain

2026-11-14: Verisign's .com RDAP lookup for `betterwaybackmachine.com` returned 404 (no registry record). This suggests it is unregistered, not a guarantee of registrar checkout availability or price. `betterwayback.com` is registered. Neither domain was purchased.

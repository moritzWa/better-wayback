# Facebook index response recovery

The reported `/?url=facebook.com` screenshot showed an index lookup failure:
`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.

Both the upstream CDX reader and browser job request parsed JSON without handling
an intermediary's HTML response. The screenshot alone does not identify which
intermediary returned that HTML. Live checks returned valid jobs for the default
Facebook search, 16 samples and an explicit 1996–2026 range before this fix.

The fix covers both paths. CDX reads retry a malformed JSON/HTML response or
transient 500/502/503/504 once per query, with at most two extra requests across
the whole lookup. The retry shares the query's existing deadline. No retry is
allowed for throttling, unsafe redirects, schema errors or cancellation.
The browser retries a non-JSON intermediary response once, but never retries
intentional JSON errors from the app, including quota denials. Persistent errors
use readable copy instead of exposing a parser exception or upstream HTML.

Verification:

- Full automated suite: 110 passed, five opt-in tests skipped.
- Regression fixtures cover HTML-to-JSON recovery, persistent malformed responses,
  cancellation, shared retry budget, throttling and intentional API errors.
- The Facebook UI fixture checks one retry followed by a real app timeline, then
  a persistent HTML failure with no parser leak or false empty-history message.
- Six headless UI suites passed: index/Facebook recovery, HTML previews, shared
  search URLs, timeline navigation, packaged examples and the main timeline UI.
- Cloudflare deploy dry run passed with unchanged bindings and free-tier guards.

These recovery cases use controlled response fixtures. They do not claim that
the Internet Archive will always be available or that Facebook's archived assets
are visually complete.

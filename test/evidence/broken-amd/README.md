# Broken AMD capture

Verified November 16, 2026 against the exact reported replay:
https://web.archive.org/web/20080828141224/http://www1.amd.com/

The `id_` response returned HTTP 200 with 598 bytes. Its SHA-256 was
`ae4ab470f6f91c0288767dfe47ffe9e0a5eaa68f691d5ec5065e6b2ceae993f7`.
The document ends at `f` inside an unclosed script in the head. It has no
page body. The `if_` replay contained the same broken source plus Archive
injections and its playback comment. Waiting for assets cannot restore this body.

`test/fixtures/amd-20080828141224.html` preserves that response with one added
terminal newline. `test/html-extraction.test.js` runs it through the real native
HTMLRewriter in workerd, not a replacement regex parser. It confirms empty text
and `replayUnavailable: true`, including with Archive injections. It also checks
that short pages, image/SVG pages, JavaScript shells and readable pages with a
later truncated script are not marked broken. This checks rejection, not repaired
rendering. No screenshot is claimed to contain missing AMD content.

The full automated run passed 102 tests, with five opt-in tests skipped. Four
headless UI fixture suites passed: HTML previews, date navigation, timeline UI
and support/SSE recovery. They check failure removal during loading and in both
views, pending dates, all-failed empty state, iframe cleanup and later screenshot
recovery. Those UI fixtures are not real Archive rendering evidence.

Cloudflare's deploy dry run passed with unchanged resource bindings and free-tier
budgets. Broken HTML uses a five-minute failure TTL rather than successful-cache
retention. Existing valid PNGs remain available.

## Production

Merged as #5 (Omit failed captures from the visual timeline) and deployed as
Worker version `925d39ed-c310-4f86-b492-9087c8a849f3`.

The public 2008 timeline for `http://www1.amd.com/` finished its metadata stream
in 2.212 seconds. It returned July 23 as available and the exact August 28
timestamp `20080828141224` as `replayUnavailable: true`, with
`error: "Incomplete archive capture."` and `htmlVersion: "html-v2"`.
This measured metadata lookup, not screenshot rendering.

The deployed `/app.js` matched merged main byte-for-byte, SHA-256
`46727292fc4e03a268abc41c85fc920d999ef8d9d81af8c5eac41b8f471a347d`.

A headless check of that public search confirmed one visible card in both views
and no August 28 navigation entry. Stats retained `1 unavailable`. It used the
real public job and metadata stream, blocked Archive iframes and stubbed the
optional screenshot stream to avoid new rendering work. This verifies omission
in the deployed app, not the surviving July capture's visual completeness.

Readable pages with missing images, styles or other assets can still pass.
Cross-origin iframe loading does not establish visual completeness. This change
does not claim to detect or repair every partially rendered archive page.

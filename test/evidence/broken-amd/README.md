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

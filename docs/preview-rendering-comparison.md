# Screenshots versus client-rendered archive previews

Measured November 15, 2026. Production behavior was not changed during this benchmark. The disposable Cloudflare benchmark Worker was deleted after testing. HTML-first mode was implemented after approval; its current contract is in [the deployment guide](cloudflare-deployment.md).

## Who renders what

Today Cloudflare Browser Run loads an archive capture in a server-side headless browser, extracts rendered text and takes a PNG. The visitor downloads the PNG. The visitor does not run the archived page.

An alternative can fetch archived HTML on the server, extract and compare its text, and let the visitor render the HTML and its image/CSS/JavaScript assets inside a sandboxed iframe. The parent application does not need to read the iframe DOM to compare text. Our earlier claim that iframes necessarily lose text comparisons was too broad.

## Test setup

- Exact captures: Rogo `20260802001057` and Harvey `20240102030342`.
- Server: a real temporary Cloudflare Worker in the same Free account, using the existing atomic daily browser quota. No budgets were reset or paid resources enabled.
- Client: muted headless Chromium inside an existing Linux Space, 1280 by 800 viewport. Fresh isolated browser context per path.
- Paths: direct Wayback iframe; server-proxied HTML with server text extraction plus client iframe; newly generated server screenshot; existing production PNG.
- Iframe navigation was sandboxed. Browser routing blocked non-archive live fallbacks and WebSockets. The proxy ran on a separate origin, never the production app origin.
- Two iframe trials, reversing their order. Archive CDN caches were not controlled. This is a small live sample, not a statistically controlled speedup claim.

The basic proxy forwards HTML only. The client still requests its archived images, fonts, CSS and scripts from the Archive. It is not a complete asset-rewriting reverse proxy.

## Results

| Path | Rogo | Harvey |
| --- | --- | --- |
| Newly generated server screenshot, through client PNG decode | 13.60 s | 12.63 s |
| Existing PNG, through client decode | 0.69 s | 0.71 s |
| Direct iframe, first contentful paint | 1.31–1.83 s | 3.00 s in the repeat trial |
| Direct iframe, readiness heuristic | 5.17–13.19 s | About 6.2 s; see fidelity caveat below |
| Proxied HTML iframe, first contentful paint | 2.50–3.57 s | No contentful paint |
| Proxied HTML iframe, readiness heuristic | 4.92–6.24 s | Failed; still blank after 27.49 s |

Iframe first-paint timings come from the child document's PerformanceObserver. Readiness includes navigation, fonts, assets and visible-content settling. First paint can be a header, not the complete hero. The early Harvey direct-iframe check missed part of an SVG reveal in the first trial; a later repeat screenshot showed the complete hero. Do not treat that heuristic as a pixel-equivalence test.

The proxy rendered Rogo's content, but failed to load some archived fonts due to CORS. The page therefore used fallback typography. Harvey failed with an invalid history-change exception under the proxy URL and also had font CORS failures. The direct iframe and server screenshot showed the complete Harvey hero in later screenshots. A naive HTML proxy is not a reliable drop-in replacement.

## Server-side text comparison

Server text extraction took less than 1 ms at the timer's resolution. Archive HTML fetch plus body download ranged from 69 ms on a later warm request to 2.09 s on an initial request. These are separate samples with shared upstream cache effects, not guaranteed cold times.

The corrected extractor preserves block boundaries and decodes common/numeric entities. Rogo's extracted HTML text contained all words present in the server-rendered text, but also duplicated mobile/desktop markup: 6,869 characters versus 3,179 rendered characters. Harvey's text matched rendered text after ignoring whitespace. That supports HTML-first comparison for these pages, not universal equivalence. JavaScript-only text, CSS-hidden content and duplicate responsive layouts require a defined normalization policy or a rendered-text fallback.

## Recommendation

For uncached captures, compare HTML text on the server and embed the original Wayback replay directly in a sandboxed, lazy-loaded iframe. This avoids server browser launches and lets content appear progressively. Fetching the text on the server removes the parent's cross-origin DOM-access problem without rehosting the entire webpage.

Keep existing PNGs for fast, lightweight cached previews. A full HTML-and-assets reverse proxy remains possible, but needs font/module/API CORS handling, URL rewriting and history/router compatibility. Archived scripts must remain on an isolated preview origin, not the app's origin. Several active iframe pages also cost more visitor bandwidth, CPU and memory than PNGs, so load only previews near the viewport.

## Reproduction

`tools/benchmark-preview-worker.js` implements the two fixed-capture proxy/text/screenshot routes. Deploy it under a disposable Worker name with a `BROWSER` binding and a `QUOTAS` Durable Object binding referencing `QuotaCoordinator` in the production `visual-wayback` script. It must share the existing quota rather than create a fresh budget. Do not add app-domain routes or assets.

`tools/benchmark-preview-client.js` drives a dedicated muted Linux Chromium profile over forwarded CDP port 19831. Never point it at a shared/login browser: cleanup explicitly closes that browser. Run the driver through the local heavy-job queue. `BENCH_ORIGIN`, `BENCH_OUTPUT`, `BENCH_CASES`, `BENCH_MODES` and `BENCH_LINGER_MS` configure the experiment. Delete the temporary Worker and close the browser/port forward afterward; do not delete the production quota namespace.

Full local JSON and screenshots are in `~/Documents/visual-wayback/iframe-comparison/` and `iframe-comparison-repeat/`. Those are local benchmark artifacts, not production assets.

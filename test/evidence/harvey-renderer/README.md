# Exact Harvey renderer check

Capture: https://web.archive.org/web/20240218234204/https://www.harvey.ai/

Viewport: 1280 × 800. Headless Chromium. Only HTTPS requests to `web.archive.org` are allowed. No live-site fallback or synthetic content.

The shared renderer launcher explicitly sets `chromiumSandbox: true`. Browser contexts still isolate state, but are not an OS sandbox. The queued browser regression launches Chromium on this host and checks its actual command line has no `--no-sandbox` or `--disable-setuid-sandbox` flag.

## Real archive result

- `baseline.png`: old renderer, 3.318 seconds after starting. The hero is mostly black. The heading and waitlist button are missing.
- `fixed.png`: final renderer, 6.726 seconds total. Navigation took 1.009 seconds. Readiness took 5.651 seconds. The heading, blue artwork and waitlist button are visible.
- `fixed.json`: extracted text and readiness measurements from that final live run.

The old renderer applied `animation:none` and `transition:none` after 2.2 seconds. In the same baseline browser session, removing that rule let the archive finish its reveal. The supplied reference and the fixed screenshot show the same hero. Some artwork moves continuously, so its phase can differ.

The new renderer waits for asset activity, fonts, viewport images, finite animations and stable content styles. It also tracks inline-style fades driven by JavaScript. It does not cancel animations or force hidden text to appear. Unfinished captures fail instead of entering either persistent cache.

## Throughput

`throughput.json` measures two renders of the recorded real archive. HAR replay blocks missing requests, so this benchmark made zero upstream requests.

| Render pages | Two captures |
| --- | --- |
| 1 | 9.493 seconds |
| 2 | 4.797 seconds |

That is 1.98× throughput in this recorded test, not a claim about Internet Archive response times. A correct uncached page takes longer than the old incomplete screenshot. CDX responses are cached for 24 hours. Cached previews are emitted before fresh renders, and fully cached jobs do not launch Chromium.

## Repeat

Run all browser work through the resource queue:

```sh
python3 ~/.claude/scripts/heavy-job.py --wait -- node test/renderer-live.js
python3 ~/.claude/scripts/heavy-job.py --wait -- node test/renderer-live.js --fixed
python3 ~/.claude/scripts/heavy-job.py --wait -- node test/renderer-live.js --replay
python3 ~/.claude/scripts/heavy-job.py --wait -- node test/renderer-benchmark.js
python3 ~/.claude/scripts/heavy-job.py --wait -- env RENDERER_BROWSER_TESTS=1 node --test test/renderer.test.js test/renderer-api.test.js test/lib.test.js
```

The baseline command records the archive once in `test-output/harvey-renderer/archive.har`. The replay command drops aborted HAR entries and creates `replay.har`. The benchmark uses that local recording. The HAR is not committed; the before/after evidence is.

The targeted suite covers delayed CSS and JavaScript reveals, hidden-content rejection, cache invalidation, cached-first events, two-page concurrency, archive-only routing, sandbox launch options and an ephemeral API server. The review server on port 4317 was left untouched.

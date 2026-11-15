# Rogo search measurements

Measured against the real public deployment on November 15, 2026. No archive screenshots were fabricated, and no caches or daily budgets were reset.

## Findings

The old runtime launched one browser per missing capture and waited 20 seconds after every closed browser. Eight fresh captures therefore added seven deliberate pauses, or 140 seconds, before accounting for rendering and network time.

The first check of `rogo.ai` reused the user's in-progress cached job. Lookup took 0.349 seconds. Five existing previews arrived by 0.745 seconds. The request then stopped on a two-second launch cooldown. Their original recorded render times ranged from 3.994 to 9.815 seconds. This was a partial warm measurement, not a complete cold baseline.

After browser batching was deployed, a default `rogo.ai` search returned seven cached captures and rendered one missing capture. The first preview arrived at 1.098 seconds, and the full eight-capture timeline finished at 14.769 seconds. There were no deliberate pauses in that request. Cache/network conditions differed from the initial check, so these numbers are not a cold before/after speedup ratio.

A second search, `rogo.ai` from 2025 through 2026, returned two cached captures and attempted six new captures. The quota coordinator reserved a batch of five, then a batch of one after a cooldown. It completed in 101.719 seconds, including 21 seconds of cooldown. Three archive pages had unsettled assets and were visibly marked unavailable. Five captures succeeded. The five-capture batch had no launch pause between its results, removing four former 20-second pauses. Remaining latency came mostly from real archive navigation and readiness checks.

## Changes

- Reuse one browser for up to eight captures, keeping a separate isolated context for every page.
- Reserve all capture deadlines atomically; shrink batches to the remaining free budget. Do not reset existing quota state.
- Stream each result immediately, rather than wait for the whole batch.
- Retry short launch cooldowns instead of terminating an incomplete timeline.
- Look up cached metadata concurrently and check image existence using cancelled KV streams, without buffering every PNG in the Worker.
- Preserve image-pair verification, explicit failure markers, archive-only networking and browser closure.

## Iframes

The checked Rogo archive response did not set `X-Frame-Options` or a CSP `frame-ancestors` restriction. Its original site's `SAMEORIGIN` policy appeared only as the informational `x-archive-orig-x-frame-options` header. This suggests embedding is possible; it is not a browser compatibility test of every replay.

A cross-origin iframe cannot expose its DOM to the parent application. Using raw archive iframes would therefore lose rendered-text grouping/comparison unless the server still rendered the pages too. It would also make every visitor load several complete archived pages, rather than reusable PNG previews. A sandbox can limit navigation and popups, but it cannot enforce the renderer's archive-only network policy. No iframe mode was introduced in this change.

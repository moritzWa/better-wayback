# Inductive shared-search verification

Checked against production on November 16, 2026, using the exact shared URL:

`https://visualwayback.com/?url=https%3A%2F%2Fwww.inductive.bio%2F`

- Initial HTML names Inductive and includes an absolute PNG Open Graph image URL. No JavaScript is needed by the unfurler.
- The image is the genuine March 15, 2026 archive capture, not the live site or a generated placeholder. The downloaded PNG is included here and was inspected for the complete visible hero.
- The connected screenshot stream successfully cached four of eight sampled captures: April and December 2024, July 2025 and March 2026. Successful render times were 7.353, 6.218, 5.634 and 10.502 seconds respectively.
- The October 2026 and November 2023 replays did not settle within the deadline. The 2022 and June 2023 replays lacked sufficient content. They remain direct archive previews; no failed screenshot was presented as successful.
- A subsequent main timeline response finished in 819 ms. All eight comparison records were cached, and four supplied screenshot posters. The other four still require the viewer's browser to load Wayback. This does not establish instant rendering for every capture.
- The shared HTML took 859 ms and the cached PNG took 362 ms in this check. These are single observations, not latency guarantees. The image SHA-256 and individual capture states are in `production.json`.
- Images/text persist for seven days, jobs for one day. Optional screenshot caching shares the existing 540-second daily browser cap and 400-write cap. Quota failure leaves the HTML-first timeline usable.

This verification used the real public Worker, its Browser Run binding, its KV cache and Internet Archive replays. Local UI tests separately cover screenshot arrivals, unchanged HTML grouping, optional quota errors and search cleanup with labelled deterministic fixtures. No Slack message was sent; Slack may retain its own earlier unfurl.

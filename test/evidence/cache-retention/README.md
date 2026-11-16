# Frequency-aware cache retention

Verified on November 16, 2026.

## Automated checks

- Thirty recent successful searches promote existing cached captures to 90 days without launching a browser. A newer one-off remains at seven days.
- Demand decays with a 14-day half-life. Old popularity returns to baseline rather than pinning data forever.
- Thirty simultaneous renewals of one cache entry admit one fill and reserve only two KV writes. Refused fills consume neither write nor storage reservations.
- Storage reservations serialize below the 800 MiB cap, survive daily resets, retain conservative charges for replacements and release them only after expiration.
- Full storage prevents new browser work while existing previews remain available. Unfurls, images and known automated searches do not increase demand.
- Archive redirects retain the requested cache key while presenting the actual capture timestamp in the social preview.

The full suite passed 98 tests with five opt-in tests skipped. The HTML UI fixture test also passed.

## Production check

`production.json` records the live Worker version and results for the user's exact Inductive search. The real KV expiration of its March 2026 PNG agrees with the renewed seven-day metadata. Its SHA-256 is unchanged from the earlier inspected screenshot, confirming reuse rather than regeneration. HTML metadata was renewed through the deployed storage/write coordinator, and two timeline reads completed successfully.

The repeat screenshot stream returned five genuine cached PNG records and three cached unavailable attempts in 0.93 seconds, with no rendering status or new render events. The social preview still references the valid March 2026 PNG. The three unavailable attempts remain direct archive previews in the main HTML timeline, not fabricated screenshots.

Verification requests used a tagged automated user agent, so they did not promote the real site's demand score. The longer tiers and time decay are exercised with controlled clocks and API integration tests rather than fabricated popular-site traffic in production.

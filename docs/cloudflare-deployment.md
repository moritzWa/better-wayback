# Cloudflare deployment

Visual Wayback uses Workers Free with static assets, a Browser Run binding, one KV namespace and a SQLite Durable Object. There is no R2 dependency, paid plan, scheduled capture job or always-on server.

## Current HTML-first mode

`PREVIEW_MODE=html` is the public default. `ENABLE_RENDERING=false` keeps the main timeline stream HTML-first. `ENABLE_SCREENSHOT_CACHE=true` enables a separate optional connected screenshot stream after HTML comparison finishes. Cached PNGs keep their existing keys and remain usable.

The optional `/api/jobs/:id/screenshots` stream uses the existing atomic browser and write reservations, with newest missing captures first. The client attempts at most three batches, closes on quota denial or network error, and cancels on pagehide or a new search. It never blocks HTML previews or overwrites their comparison text with a different text source. No browser work runs after the connected response ends. Successful screenshots and metadata use the frequency-aware retention policy below. Complete PNG/text pairs are reused across visitors, settings and jobs for the same capture. Cache limits or archive failures can leave some captures as direct replays.

The homepage runs Worker-first so `?url=` links can return server-rendered Open Graph/Twitter metadata. Unfurls read only existing cache or packaged assets. A separate quota-counted `social:<job-id>` pointer follows the site's retention tier even after the one-day job expires. Missing image bodies never produce a broken OG image. Invalid queries fall through to static HTML; cold valid queries use the app icon. Existing Slack unfurls may need re-sharing to refresh.

The server streams direct replay links immediately, then extracts text using native HTMLRewriter. It does not execute archived scripts. Each request reads up to eight HTML documents, two concurrently, with a shared 12-second deadline per document including redirects and body download. HTML bodies are capped at 1 MiB; normalized text at 12,000 characters. Redirects remain on timestamped HTTPS web.archive.org replay URLs. Native parser output is cached under `html:html-v2:` keys using the site's retention tier; failed lookups expire after five minutes. Screenshot failure markers never block this path.

Confirmed failures are omitted from the timeline and date picker, but stay in the aggregate unavailable count. Pending dates remain until resolved. An empty document ending inside an unclosed script is a confirmed broken capture. Low text alone is not a failure: image-heavy pages and JavaScript shells keep their previews. Valid cached PNGs survive HTML failures. Transient HTML lookup errors and slow cross-origin iframe loads are not proof that the archived page is broken.

The client sends `previewMode: "html"` when creating jobs. Old screenshot-only clients receive a reload instruction before any new job work, rather than receiving iframe metadata they cannot display. Existing Node screenshot endpoints accept the additional field and retain their local behavior.

CDX HTML/truncated-JSON responses and transient HTTP 500/502/503/504 responses get at most one retry per query, with only two extra upstream requests allowed across an entire index lookup. Retries share the existing ten-second query and 55-second overall deadlines. HTTP 429, redirects, schema errors and cancellation do not retry. The browser can retry an intermediary's non-JSON job response once within a shared 65-second deadline. It never retries intentional JSON API errors or quota denials. Persistent failures show a readable error, not raw JSON parser output.

Every new HTML lookup reserves one atomic cache write before contacting the archive. No browser reservation or launch cooldown is used. Further batches resume after one second. If an HTML lookup fails or the write budget is exhausted, already indexed iframe previews stay available and their missing comparison text is labeled. Known cached jobs can still open previews; new job creation also requires the shared free write budget.

The browser scales each iframe's 1280 by 800 desktop viewport into the existing preview card. It preloads roughly two viewport heights ahead with at most two loads in flight, retaining loaded documents until bounded cache pressure (eight on higher-memory browsers, four on low-memory/Data Saver browsers, six when memory is unknown). Pagehide and new searches unload them. Interact enables the archived page's own controls; Done restores outer timeline scrolling. Cached PNGs create no iframe until interaction is requested. Iframes are sandboxed with only scripts and same-origin enabled, remain on the Archive origin, and deny autoplay, camera, microphone, geolocation and payment. Parent CSP allows Archive frames but does not allow their scripts on the app origin. Cross-origin restrictions prevent us from asserting that a load event means a visually complete replay. See [preview interaction and scroll](preview-interaction-and-scroll.md).

HTML comparison strips scripts/styles/templates and explicitly hidden content, preserves text boundaries and deduplicates exact repeated lines. Missing, pending or truncated text remains separate in grouped views. Cached rendered text may be used when HTML extraction fails; different source types are never compared or grouped together. The local Node server remains the original screenshot development path.

If every sampled capture already has a valid PNG/text pair, the runtime keeps the homogeneous rendered-text timeline and finishes without additional HTML requests or quota writes. Mixed PNG/iframe timelines use HTML comparison where available, preserving PNG previews.

## Resources

- Worker: `visual-wayback`, personal Cloudflare account.
- Hostnames: `visualwayback.com`, `www.visualwayback.com` and `visual-wayback.moritzw.workers.dev`.
- DNS: Cloudflare, with `quincy.ns.cloudflare.com` and `yolanda.ns.cloudflare.com` delegated at Porkbun.
- KV: `visual-wayback-cache`, bound as `CACHE`.
- D1: `visual-wayback-analytics`, bound as `ANALYTICS`. Capped, optional [usage analytics](usage-analytics.md).
- Durable Object: `QuotaCoordinator`, bound as `QUOTAS`. The `v1` migration uses `new_sqlite_classes`, supported on Workers Free.
- Browser: `BROWSER`, using `@cloudflare/playwright`.
- Static assets: `.cache/cloudflare-assets`, bound as `ASSETS`. Demos and blog pages bypass the Worker where possible.

The account already has unrelated services. Do not change their subscriptions or use their storage for this app.

## Deploy

```sh
npm ci
npm run test:cloudflare
npm run check:cloudflare
npx wrangler deploy
```

Use the deployment credentials from 1Password, not a token committed to this repository. The Main-vault item is **Cloudflare Visual Wayback deployment token**. It expires February 13, 2027. **Visual Wayback Turnstile** holds the managed widget key pair. The existing **Cloudflare** login has the password and TOTP for the dashboard.

Set `SUPPORT_EMAIL` and `TURNSTILE_SECRET_KEY` with `wrangler secret put`. `TURNSTILE_SITE_KEY` is public configuration. Never put the address or secret key in HTML, JavaScript assets, build output or a public environment file.

`npm run build:cloudflare` builds the blog, demo API files, headers and shared archive renderer. It fails if the source renderer no longer matches the extraction contract. Node's `redirect: "error"` is unsupported in Workers; edge fetches use `manual` and reject redirect responses.

## Free limits

Cloudflare publishes 10 browser minutes per day on Workers Free, shared across the account. HTML comparisons, unfurls and static examples do not consume this allowance. Optional screenshot caching and legacy rendering share the app's 540-second budget. A launch reserves 90 seconds for the first capture and 25 seconds for each additional capture, up to eight. The coordinator shrinks batches to the remaining time/write budget. A confirmed browser closure refunds the unused time, retaining elapsed seconds plus a two-second margin. Failed or unconfirmed closures keep the full reservation. Atomic reservations and single-use refund tokens prevent concurrent requests from overspending that budget. Platform limits can still reject requests earlier if other applications use the same account.

`RENDER_BATCH_SIZE=8` reuses a browser across sequential captures, with a fresh isolated context for each. Each capture still has a 25-second deadline. The whole connected request has a deadline of 25 seconds times its reserved capture count. A timed-out capture closes the browser; later captures resume in a new request. There is no 20-second launch pause within a batch. No work depends on `waitUntil` or a disconnected client.

The app limits new jobs to 250 per UTC day and KV writes to 900 per day, retaining headroom below Cloudflare's account-wide 1,000-write limit. Jobs and archive indexes still expire after one day so new captures can be discovered. Unavailable screenshot attempts get separate one-hour failure markers and do not block later dates. These markers never count as successful screenshots. Images are limited to 2 MiB and metadata to 64 KiB. New rendering fails closed without the quota binding. Keep the account on Workers Free; never upgrade it automatically.

### Frequency-aware retention and storage

Successful searches increment a hostname-level demand score in the existing Durable Object, including cached job hits. `www` and bare hostnames share demand. Scores decay with a 14-day half-life, are capped at 1,000 and rounded for tier selection: fewer than three recent weighted searches gets seven days, three gets 14 days, ten gets 30 days and thirty gets 90 days. This counts searches, not distinct people. GET requests, stream continuations, screenshots, unfurls and known automated clients do not raise demand. Counters store only a hostname hash, score and update time; no raw URL or visitor identifier. At most 4,096 host counters are admitted. At capacity, new-host admission scans at most 32 counters for a slot unused for 90 days; if none is found, the new host retains baseline retention without another counter. This housekeeping never deletes captures.

The screenshot stream renews complete existing PNG/metadata pairs without launching a browser. HTML records renew on comparison reads. Both renew when promoted to a longer tier, otherwise only when less than half the requested retention remains. Share pointers renew similarly. Atomic 65-second fill leases prevent concurrent visitors from rewriting the same cache keys while KV updates propagate; a promotion can wait for that brief cooldown. The daily write cap bounds the lease map, and expired leases are removed on the next storage reservation. This avoids spending a KV write on every hit. Failed lookups never receive longer retention.

Before cache writes, the coordinator atomically reserves bytes in expiration-day buckets, up to an 800 MiB application budget. Keys and values count toward this bound. Replacements and uncertain/failed writes are charged again until their prior expiry; the deliberately conservative counter can therefore refuse writes before physical storage is full. Reservations survive daily quota resets. No cache entry is actively deleted to make room; low-demand entries expire sooner, and new fills stop when storage is full. Cached reads and static assets remain available. Browser launches first check room for a maximum-sized capture. Platform account-wide limits can still reject earlier if unrelated namespaces consume the remaining space.

The rollout reserves 128 MiB for legacy seven-day data for eight UTC day buckets. Before deployment, all 169 existing application KV keys were read and measured at 7,133,433 value bytes, safely below this reserve. The extra day covers bucket rounding. Support counters remain separately write-capped, tiny and short-lived. No namespace, paid service, cron or data-deletion job is added.

## Verified remotely

For the November 16 frequency-aware retention rollout, the real KV image expiration matched its renewed seven-day metadata, and the inspected March 2026 PNG retained the same SHA-256. HTML renewal and subsequent timeline reads passed through the deployed coordinator. A repeat screenshot stream returned five cached PNGs plus three explicit unavailable attempts in 0.93 seconds with no new rendering. [Retention evidence](../test/evidence/cache-retention/README.md) records the live version, exact expirations and automated checks for longer demand tiers, decay and concurrent renewal safety.

On November 16, 2026, the exact shared Inductive URL returned site-specific initial HTML with a genuine cached March 2026 screenshot as its Open Graph image. Four of eight sampled screenshots were cached successfully. A repeat timeline finished with eight cached comparison records and four cached PNG posters in 819 ms. The other four captures still use direct archive replays. Timings, archive limitations and the inspected PNG are recorded in [the shared-search evidence](../test/evidence/inductive-share/README.md). No paid plan or service was provisioned.

For the HTML-first rollout on November 15, 2026, a real Rogo 2026 timeline returned its first replay link 0.46 seconds after connecting to SSE and completed eight HTML comparisons in 7.05 seconds. That excludes the earlier CDX lookup. The test Worker had no Browser Run binding, so those lookups could not launch server browsers.

On the public domain, a fresh muted Linux browser context opened the same timeline with cached HTML metadata. Metadata was complete at 1.58 seconds, an iframe was attached at 1.69 seconds, first iframe content painted at 3.38 seconds and a visible hero heading appeared at 9.33 seconds. Archive asset caching was not controlled. At most two iframe documents were active; switching to Stripe removed the live frames and retained its four genuine cached captures. These are observations of one timeline, not an instant-render guarantee.

On November 15, 2026, `https://visualwayback.com/` served the app with valid HTTPS. Both articles, discovery routes, support configuration, JavaScript assets and all ten packaged PNGs passed custom-domain checks. Initial HTML and public assets contained no support address. Deployment is manual with Wrangler; no GitHub auto-deploy workflow is configured.

On November 15, 2026, the real Cloudflare Browser Run binding rendered Harvey's January 2, 2024 archive capture in about 10.6 seconds. The resulting PNG showed its complete hero, not a blank entrance animation. The response streamed a capture and continuation event, and the PNG was served from KV. This is one successful capture, not a claim that every archived site works.

The deployed support flow kept the address out of the initial DOM, loaded Turnstile after clicking, and revealed the address after completing the real challenge. An invalid token returned 403 with `Cache-Control: no-store` and no address. Automated tests cover quota failure, cached results, response headers, static routes and SSE reconnection. Bots that pass Turnstile can still retrieve the address.

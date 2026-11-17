# Usage analytics

App visits and the usage funnel live in the dedicated free Cloudflare D1 database
`visual-wayback-analytics`. No public reporting endpoint is exposed.

Read the last 30 active days with your authenticated Wrangler CLI:

```sh
npx wrangler d1 execute visual-wayback-analytics --remote --command "$(cat tools/usage.sql)"
```

`engaged_sessions` counts distinct tab sessions that displayed a timeline after a
deliberate search/demo click, or opened a shared custom search. Automatic Stripe
loads are separate. These are not unique people, and anonymous events are not
proof of humans. Blockers, Global Privacy Control, disabled storage and automation
can cause undercounting. Blog views are not collected.

Each search sends at most one of each event: start, ready, failure/quota, and preview
click. Ready means at least one usable capture record was displayed, not that an
Archive iframe rendered fully. Preview clicks include opening the archive or
entering interaction mode. Partial timelines can be both ready and failed. Cache
is `yes` for packaged demos or all observed cached capture events, `no` if a fresh
capture event was observed, and otherwise `unknown`.

Only minute-resolution UTC time, event type, random tab-session/search/event IDs,
demo/custom mode, automatic/user source, cache flag and duration are stored. No
searched domains, URLs, IPs, referrers, user agents, cookies or fingerprints.
Session IDs live in sessionStorage, not persistent local storage. The request
omits credentials and referrer. The server discards unknown fields, rejects
cross-origin submissions, filters obvious bot user agents, and caps bodies at
1 KiB. Anonymous analytics can still be spoofed.

Open `https://visualwayback.com/?analytics=off` before manual testing. This disables
tracking for the tab; `?analytics=on` re-enables it. WebDriver and non-production
hosts are excluded automatically. Live verification uses the reserved probe
session `00000000-0000-4000-8000-000000000000`, excluded from reports.

SQLite triggers atomically limit storage to 2,000 events per UTC day. At the cap,
reports are incomplete, not an exact zero. Duplicated event IDs do not increase
the count. The first accepted event of an active day prunes data older than 30
calendar days. If traffic stops, old rows remain until the next accepted event;
there is no cron. At most 60,000 event rows are retained after pruning. The cap
keeps ordinary indexed writes below D1's free daily write allowance; account-wide
Workers/D1 limits can still reject requests sooner. Nothing upgrades the plan.
Failures return an empty response and never block search, demos or previews.

Cloudflare Web Analytics was not enabled: the available deployment and OAuth
credentials cannot create a RUM site (403). The existing CSP continues to block
external beacons. D1 page views cover the app instead, without loosening CSP.

## Archive replay health

Previews are live archive.org replays, so archive.org slowness or refusals show up as
grey or empty cards. Each search reports up to three `preview_health` batches (when the
tab is hidden or closed, and when the next search starts), holding only counts: replays
that loaded, replays archive.org refused (and we retried), replays we gave up on, and the
median load time of the loaded ones in `duration_ms`. Hosts, URLs and capture dates are
never sent. The last query in `tools/usage.sql` groups these per UTC hour, so you can
tell an archive.org incident (refused share jumps for everyone in the same hours) from a
site bug (refusals stay near zero while cards still fail).

A refusal is a replay document whose load event fires within 0.7 seconds, which is how
Chrome reports a refused request. It is a heuristic: a fully cached replay that loads
faster would be miscounted and retried.

Existing databases need the one-time migration:

```sh
npx wrangler d1 execute visual-wayback-analytics --remote --file cloudflare/analytics-migration-2026-11-17.sql
```

## Verification

On November 16, 2026, the full suite passed (86 tests, 5 skipped). A headless
integration run exercised automatic Stripe, deliberate Amazon, preview interaction,
a custom-search quota failure and opt-out with no page errors:

```sh
python3 ~/.claude/scripts/heavy-job.py --wait -- npm test
python3 ~/.claude/scripts/heavy-job.py --wait -- node test/analytics-ui.js
```

The deployed JavaScript matched local source. A live marked probe returned 204
and was read back from remote D1; a cross-origin probe returned 204 but created no
row. The reporting query excludes the marked probe. A live headless homepage
check displayed four Stripe cards with no page errors and no tracking requests
when opted out. This verifies tracking plumbing, not archived iframe fidelity.

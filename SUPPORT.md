# Support email reveal

The address stays in the server environment, not HTML, JavaScript, source maps or
public GET responses. Clicking **Support this project** fetches a public site key
and loads Turnstile. Only a same-origin POST with a valid token returns a mailto
address, which the client then inserts into the page. Cancel removes it again.

This reduces casual scraping. Bots can emulate clicks and may pass challenges.
It does not make the address bot-proof or keep it secret after a successful reveal.

## Environment contract

- `SUPPORT_EMAIL`: private address, configured as a server secret.
- `TURNSTILE_SITE_KEY`: public widget key.
- `TURNSTILE_SECRET_KEY`: private Siteverify key.
- `CACHE`: KV namespace supporting `get(key)` and `put(key, value, options)`.
- `QUOTAS`: Cloudflare quota coordinator. A successful POST to its singleton
  `global` object's `https://quota/write` reserves each KV write.

Turnstile must allow the deployed hostname. Verification requires `success: true`,
action `support-reveal` and the exact request URL hostname. Missing keys, an invalid
address, KV failures and verification failures all fail closed. Local Node uses
process environment variables and a bounded in-memory rate store, never a bundled
address. An unconfigured local preview shows a short unavailable message.

`GET /api/support/config` returns only `{siteKey}` when configured.
`POST /api/support/reveal` accepts JSON `{token}` and returns `{mailto}` on success.
All responses use `Cache-Control: no-store`; no CORS permission is granted.

The handler limits bodies to 4 KiB and tokens to 2,048 characters. A hashed-IP KV
counter permits five attempts per ten-minute window. KV is eventually consistent,
so concurrent requests may exceed that approximate limit. The atomic global write
budget provides an additional daily bound on Cloudflare. No tokens or addresses
are stored in KV or returned in errors.

CSP permits scripts, frames and connections to only the explicit Turnstile host
`https://challenges.cloudflare.com` in addition to existing same-origin sources.
Blog JSON-LD hashes stay intact. No `unsafe-inline` is added.

## Focused tests

Run through the local shared job queue where available:

```sh
node --test test/support.test.js
node test/support-ui.js
```

UI tests use headless Chromium, a bounded ephemeral Node server and a stubbed
Turnstile response. They do not prove that a production Turnstile account is
configured. Test mail addresses use `example.invalid`. Screenshots are written to
`artifacts/support/` and must not contain a real address.

The same UI suite checks Cloudflare's one-capture SSE continuation: reconnects
honor server cooldowns (at least 20 seconds, 90 seconds when unspecified), replayed captures are deduplicated, quota failures keep
partial results, and a terminal error never retries automatically.

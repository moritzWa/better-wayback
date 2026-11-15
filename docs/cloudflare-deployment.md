# Cloudflare deployment

Visual Wayback uses Workers Free with static assets, a Browser Run binding, one KV namespace and a SQLite Durable Object. There is no R2 dependency, paid plan, scheduled capture job or always-on server.

## Resources

- Worker: `visual-wayback`, personal Cloudflare account.
- Hostnames: `visualwayback.com`, `www.visualwayback.com` and `visual-wayback.moritzw.workers.dev`.
- DNS: Cloudflare, with `quincy.ns.cloudflare.com` and `yolanda.ns.cloudflare.com` delegated at Porkbun.
- KV: `visual-wayback-cache`, bound as `CACHE`.
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

Cloudflare publishes 10 browser minutes per day on Workers Free, shared across the account. Static examples do not consume this allowance. The app caps its own budget at 540 seconds. A launch reserves 90 seconds for the first capture and 25 seconds for each additional capture, up to eight. The coordinator shrinks batches to the remaining time/write budget. A confirmed browser closure refunds the unused time, retaining elapsed seconds plus a two-second margin. Failed or unconfirmed closures keep the full reservation. Atomic reservations and single-use refund tokens prevent concurrent requests from overspending that budget. Platform limits can still reject requests earlier if other applications use the same account.

`RENDER_BATCH_SIZE=8` reuses a browser across sequential captures, with a fresh isolated context for each. Each capture still has a 25-second deadline. The whole connected request has a deadline of 25 seconds times its reserved capture count. A timed-out capture closes the browser; later captures resume in a new request. There is no 20-second launch pause within a batch. No work depends on `waitUntil` or a disconnected client.

The app limits new jobs to 100 per UTC day and KV writes to 400 per day. Previews expire after seven days; jobs expire after one day. Unavailable captures get separate one-hour failure markers, remain visible and do not block later dates. These markers never count as successful screenshots. Images are limited to 2 MiB and metadata to 64 KiB. New rendering fails closed without the quota binding. Keep the account on Workers Free; never upgrade it automatically.

## Verified remotely

On November 15, 2026, `https://visualwayback.com/` served the app with valid HTTPS. Both articles, discovery routes, support configuration, JavaScript assets and all ten packaged PNGs passed custom-domain checks. Initial HTML and public assets contained no support address. Deployment is manual with Wrangler; no GitHub auto-deploy workflow is configured.

On November 15, 2026, the real Cloudflare Browser Run binding rendered Harvey's January 2, 2024 archive capture in about 10.6 seconds. The resulting PNG showed its complete hero, not a blank entrance animation. The response streamed a capture and continuation event, and the PNG was served from KV. This is one successful capture, not a claim that every archived site works.

The deployed support flow kept the address out of the initial DOM, loaded Turnstile after clicking, and revealed the address after completing the real challenge. An invalid token returned 403 with `Cache-Control: no-store` and no address. Automated tests cover quota failure, cached results, response headers, static routes and SSE reconnection. Bots that pass Turnstile can still retrieve the address.

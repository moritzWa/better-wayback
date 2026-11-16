# Replay recovery, November 15, 2026

The reported a16z dates resolve to these exact archive captures:

- `20090709131715`, `http://a16z.com:80/`: a GoDaddy parked-domain page, not the later venture firm homepage.
- `20161001183403`, `https://a16z.com/`: the old blog homepage. Some archived artwork is missing, but the page is not blank.
- `20211024095057`, `https://a16z.com/`: the Future hero and news homepage.

`a16z-*.png` are screenshots of real cross-origin Internet Archive documents in the updated client. Archive HTML, scripts and assets were not intercepted. The application and recorded production SSE metadata were served through a local Playwright route to avoid creating more server jobs. Both runs used fresh muted headless Chromium contexts.

`baseline.json` and `fixed.json` record each card after a 24-second observation window. These are checkpoint times, **not navigation or first-paint latency measurements**. All three real documents painted in both runs. The old 2009 document still lacked a load event at its checkpoint; the updated run received it. Network/cache variation was uncontrolled, so this is not evidence of a speed improvement. The screenshot-reported blank states did not recur naturally in these real-network runs.

The permanent-timeout bug is reproduced deterministically in `test/preview-scheduler.test.js`: an offscreen document stalls beyond 20 seconds and is removed; the old scheduler never retries it on ordinary viewport entry. The updated client retries once, bounds further automatic attempts, retains a manual retry, and prioritizes ordinary visible destinations over stalled offscreen loads. Other checks retain painted on-screen documents despite late assets and verify shimmer with/without a poster, reduced motion, memory budgets, two loading slots and cleanup.

## Thrive's repeated design

`thrive-text.json` contains production HTML comparison text for the exact 2015, 2017 and 2019 captures in the report. The 53% 2015→2017 difference includes “media and internet investments” becoming “internet and software investments”, plus changed contact lines. The 10% 2017→2019 difference is solely `pr@thrivecap.com` becoming `[email protected]`. The latter can be an email-protection artifact, not evidence of a changed visual design or a deliberate contact change. The comparison remains text-only; the view is now named **Text changes**.

## Re-run

From the repository root, through the local heavy-job queue:

```sh
python3 ~/.claude/scripts/heavy-job.py --wait -- node tools/check-replay-recovery.js test/evidence/replay-recovery/a16z-events.txt artifacts/replay-recovery/recheck .
```

Real archive requests can fail or render incompletely. This check does not repair missing archived assets or use a screenshot as proof that every asset loaded.

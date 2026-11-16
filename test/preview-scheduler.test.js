// Deterministic browser fixtures, not evidence of real Archive rendering fidelity.
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true });
try {
  for (const [memory, saveData, limit] of [[8, false, 8], [4, false, 4], [undefined, false, 6], [8, true, 4]]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.addInitScript(({ memory, saveData }) => {
      Object.defineProperty(navigator, 'deviceMemory', { get: () => memory });
      Object.defineProperty(navigator, 'connection', { get: () => ({ saveData }) });
    }, { memory, saveData });
    const js = await readFile('public/previews.js', 'utf8');
    const css = await readFile('public/previews.css', 'utf8');
    await page.route('https://fixture.invalid/**', route => {
      if (route.request().url().endsWith('previews.js')) return route.fulfill({ contentType: 'text/javascript', body: js });
      return route.fulfill({ contentType: 'text/html', body: `<style>${css}body{margin:0}.live-preview{width:800px;margin-bottom:200px}</style><div id="actions"></div><main></main><script type="module">import * as api from '/previews.js';window.api=api;window.make=(n,manual=false)=>{const w=api.livePreview({previewUrl:'https://web.archive.org/web/'+(2000+n)+'0101000000if_/https://example.invalid/'},'Fixture '+n,{manual,poster:manual?'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="#28476b"/><text x="90" y="180" fill="white" font-family="sans-serif" font-size="48">Archived screenshot fixture</text><rect x="90" y="260" width="760" height="22" fill="#9cb4cf"/><rect x="90" y="310" width="600" height="22" fill="#9cb4cf"/></svg>'):undefined});w.id='p'+n;document.querySelector('main').append(w);return w};window.ready=true;</script>` });
    });
    let active = 0, peak = 0, requests = 0, popups = 0;
    page.on('popup', p => { popups++; void p.close(); });
    await page.route('https://web.archive.org/**', async route => {
      active++; requests++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 120));
      active--;
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><body style="height:4000px;margin:0"><button onclick="this.textContent='Clicked';window.clicked=true">Actual archive action</button><input value="original"><script>window.marker=Math.random();try{top.document.body.dataset.escaped='yes'}catch{document.body.dataset.blocked='yes'}try{window.open('https://evil.invalid')}catch{}</script>` }).catch(() => {});
    });
    await page.goto('https://fixture.invalid/');
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => { for (let n = 0; n < 16; n++) window.make(n); api.refreshPreviews(); });
    await page.waitForFunction(() => document.querySelector('#p2 iframe') && document.querySelector('#p2').dataset.previewState === 'ready');
    assert.ok(peak <= 2, 'two in-flight document loads');
    assert.ok(await page.locator('#p2').evaluate(n => n.getBoundingClientRect().top > innerHeight), 'preload ahead of viewport');
    const first = page.locator('#p0 iframe');
    const child = await (await first.elementHandle()).contentFrame();
    await child.waitForFunction(() => document.body.dataset.blocked === 'yes');
    assert.equal(popups, 0); assert.equal(await page.locator('body').getAttribute('data-escaped'), null);
    assert.equal(await first.getAttribute('sandbox'), 'allow-scripts allow-same-origin');
    assert.equal(await first.getAttribute('loading'), 'eager');
    assert.equal(await first.getAttribute('tabindex'), '-1');
    const marker = await child.evaluate(() => window.marker);
    await child.locator('input').fill('retained session');
    await page.mouse.move(300, 300); await page.mouse.wheel(0, 250);
    await page.waitForFunction(() => scrollY > 100);
    assert.equal(await child.evaluate(() => scrollY), 0, 'default wheel belongs to outer timeline');
    await page.evaluate(() => { scrollTo(0, 0); api.refreshPreviews(); document.querySelector('#actions').append(document.querySelector('#p0 .preview-interact-button')); });
    await page.locator('#actions button').click();
    assert.equal(await first.getAttribute('tabindex'), '0');
    await child.locator('button').click();
    assert.equal(await child.evaluate(() => window.clicked), true);
    const outer = await page.evaluate(() => scrollY);
    await page.mouse.move(300, 300); await page.mouse.wheel(0, 250);
    await child.waitForFunction(() => scrollY > 0);
    assert.equal(await page.evaluate(() => scrollY), outer, 'interaction wheel belongs to archive');
    await page.locator('#actions button').click();
    await page.evaluate(() => { scrollTo(0, 700); api.refreshPreviews(); scrollTo(0, 0); api.refreshPreviews(); });
    assert.equal(await child.evaluate(() => window.marker), marker);
    assert.equal(await child.locator('input').inputValue(), 'retained session');
    assert.equal(await page.locator('#p0 .live-status').isVisible(), false, 'no routine success banner');
    await page.evaluate(() => api.prioritizePreview(document.querySelector('#p14')));
    await page.waitForFunction(() => document.querySelector('#p14').dataset.previewState === 'ready');
    assert.ok(await page.locator('#p14').evaluate(n => n.getBoundingClientRect().top > innerHeight * 3), 'minimap priority loads destination before jump');
    // Keep the first archive pinned while traversing beyond every cache budget.
    await page.locator('#actions button').click();
    for (let n = 1; n < 16; n++) {
      // Repeated minimap priming of resident documents must not pin the cache.
      await page.evaluate(() => { for (const frame of document.querySelectorAll('iframe')) api.prioritizePreview(frame.closest('.live-preview')); });
      await page.evaluate(n => { document.querySelector('#p' + n).scrollIntoView(); api.refreshPreviews(); }, n);
      await page.waitForFunction(n => document.querySelector('#p' + n).dataset.previewState === 'ready', n);
      assert.ok(await page.locator('iframe').count() <= limit, `resident budget ${limit}`);
    }
    assert.equal(await child.evaluate(() => window.marker), marker, 'interaction pinned against eviction');
    assert.ok(requests >= 16); assert.ok(peak <= 2);
    await page.evaluate(() => { document.querySelector('main').replaceChildren(); api.refreshPreviews(); window.manual = window.make(20, true); manual.scrollIntoView(); api.refreshPreviews(); });
    const before = requests;
    await page.waitForTimeout(250);
    assert.equal(await page.locator('iframe').count(), 0); assert.equal(requests, before, 'manual posters never request archive before click');
    const manualPattern = 'https://web.archive.org/web/20200101000000if_/**';
    let releaseManual;
    const manualRequested = new Promise(resolve => { releaseManual = resolve; });
    await page.route(manualPattern, route => releaseManual(route));
    assert.equal(await page.locator('#p20 .live-stage').evaluate(n => getComputedStyle(n, '::after').content), 'none', 'Idle poster never shimmers');
    await page.locator('#p20 .preview-interaction-shield').click();
    const manualRequest = await manualRequested;
    assert.equal(await page.locator('#p20 .preview-poster').isVisible(), true, 'poster remains during delayed load');
    assert.equal(await page.locator('#p20').getAttribute('aria-busy'), 'true');
    assert.match(await page.locator('#p20 [role="status"]').textContent(), /Loading from the Internet Archive/);
    const shimmer = await page.locator('#p20 .live-stage').evaluate(n => { const s = getComputedStyle(n, '::after'); return { name: s.animationName, pointer: s.pointerEvents }; });
    assert.equal(shimmer.name, 'preview-loading-shimmer', 'Loading interactivity shimmers over the screenshot');
    assert.equal(shimmer.pointer, 'none', 'Loading shimmer cannot trap clicks/scrolls');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('#p20 .live-stage').evaluate(n => getComputedStyle(n, '::after').animationName), 'none', 'Reduced motion uses a static loading wash');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    if (memory === 8 && !saveData) {
      await mkdir('test-output', { recursive: true });
      await page.locator('#p20 .live-stage').evaluate(async n => {
        const animations = n.getAnimations({ subtree: true });
        for (const a of animations) { a.pause(); await a.ready; a.currentTime = 800; }
      });
      assert.ok(await page.locator('#p20 .live-stage').evaluate(n => Math.abs(new DOMMatrixReadOnly(getComputedStyle(n, '::after').transform).m41) < 1), 'Shimmer visibly crosses the screenshot at animation midpoint');
      await page.screenshot({ path: 'test-output/preview-loading-shimmer.png' });
    }
    await manualRequest.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Interactive archive fixture</p>' });
    await page.unroute(manualPattern);
    await page.waitForFunction(() => manual.dataset.previewState === 'ready');
    assert.equal(await page.locator('#p20 .preview-poster').isVisible(), false);
    assert.equal(await page.locator('#p20').getAttribute('aria-busy'), null);
    assert.equal(await page.locator('#p20 .live-stage').evaluate(n => getComputedStyle(n, '::after').content), 'none', 'Ready replay removes shimmer');
    // Only one archive can capture input, even when its control was relocated.
    await page.evaluate(() => { window.other = window.make(21, true); other.scrollIntoView(); });
    await page.locator('#p21 .preview-interact-button').click();
    assert.equal(await page.locator('.is-interacting').count(), 1);
    assert.equal(await page.locator('#p20 iframe').getAttribute('tabindex'), '-1');
    await page.waitForFunction(() => other.dataset.previewState === 'ready');
    if (memory === 8 && !saveData) {
      await page.evaluate(() => { api.resetPreviews(); document.querySelector('main').replaceChildren(); });
      let stalled;
      await page.route('https://slow.invalid/image', route => { stalled = route; });
      await page.route('https://web.archive.org/web/20220101000000if_/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><input value="painted"><img src="https://slow.invalid/image"><script>window.marker=Math.random()</script>' }));
      await page.clock.install();
      await page.evaluate(() => { window.slow = window.make(22, true); slow.scrollIntoView(); });
      await page.locator('#p22 .preview-interact-button').click();
      await page.waitForFunction(() => slow.dataset.previewState === 'loading');
      const painted = await (await page.locator('#p22 iframe').elementHandle()).contentFrame();
      await painted.locator('input').fill('visible unfinished document state');
      const paintedMarker = await painted.evaluate(() => window.marker);
      await page.clock.fastForward(20001);
      assert.equal(await page.locator('#p22').getAttribute('data-preview-state'), 'loading', 'visible interacting document survives slow load event');
      assert.equal(await page.locator('#p22 .preview-retry-button').isVisible(), true, 'slow on-screen load offers retry without discarding painted content');
      assert.equal(await painted.locator('input').inputValue(), 'visible unfinished document state');
      assert.equal(await painted.evaluate(() => window.marker), paintedMarker);
      await page.locator('#p22 .preview-interact-button').click();
      await page.clock.fastForward(10001);
      assert.equal(await page.locator('#p22').getAttribute('data-preview-state'), 'loading', 'visible noninteractive document also survives deadline');
      await page.locator('#p22 .preview-interact-button').click();
      await page.evaluate(() => { document.querySelector('main').style.minHeight = '5000px'; scrollTo(0, 3000); api.refreshPreviews(); });
      await page.clock.fastForward(10001);
      assert.equal(await page.locator('#p22').getAttribute('data-preview-state'), 'loading', 'offscreen interaction remains pinned');
      assert.equal(await painted.locator('input').inputValue(), 'visible unfinished document state');
      await page.evaluate(() => slow.querySelector('.preview-interact-button').click());
      await page.clock.fastForward(10001);
      assert.equal(await page.locator('#p22').getAttribute('data-preview-state'), 'error');
      assert.equal(await page.locator('#p22 iframe').count(), 0, 'timeout frees loading slot and document');
      assert.match(await page.locator('#p22 .live-status').textContent(), /too long/);
      assert.equal(await page.locator('#p22 .preview-interact-button').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#p22 .preview-interaction-shield').isVisible(), true);
      assert.equal(await page.locator('#p22 .preview-retry-button').isVisible(), true, 'timeout has a direct retry action');
      await stalled?.abort().catch(() => {});
      await page.unroute('https://slow.invalid/image');
      await page.unroute('https://web.archive.org/web/20220101000000if_/**');
      await page.evaluate(() => { document.querySelector('main').style.minHeight = ''; });
      await page.locator('#p22 .preview-interact-button').click();
      await page.waitForFunction(() => slow.dataset.previewState === 'ready');
      assert.equal(await page.locator('#p22 .preview-retry-button').isVisible(), false);
      await page.evaluate(() => { api.resetPreviews(); window.failure = window.make(23, true); failure.scrollIntoView(); });
      await page.locator('#p23 .preview-interact-button').click();
      await page.evaluate(() => failure.querySelector('iframe').dispatchEvent(new Event('error')));
      assert.equal(await page.locator('#p23').getAttribute('data-preview-state'), 'error');
      assert.equal(await page.locator('#p23 iframe').count(), 0);
      assert.equal(await page.locator('#p23 .preview-interact-button').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#p23 .preview-interaction-shield').isVisible(), true);
      await page.locator('#p23 .preview-retry-button').click();
      await page.waitForFunction(() => failure.dataset.previewState === 'ready');
      await page.evaluate(() => { api.resetPreviews(); document.querySelector('main').replaceChildren(); scrollTo(0, 0); });
      const held = [];
      const delayedPattern = /https:\/\/web\.archive\.org\/web\/202[45]0101000000if_\//;
      await page.route(delayedPattern, route => { held.push(route); });
      await page.evaluate(() => { for (const n of [24,25,26]) window.make(n).style.marginBottom = '400px'; api.refreshPreviews(); });
      await page.waitForFunction(() => document.querySelectorAll('[data-preview-state="loading"]').length === 2);
      assert.equal(await page.locator('#p24 .live-stage').evaluate(n => getComputedStyle(n, '::after').animationName), 'preview-loading-shimmer', 'live previews without screenshot posters also shimmer');
      await page.evaluate(() => api.prioritizePreview(document.querySelector('#p26')));
      assert.equal(await page.locator('#p24').getAttribute('data-preview-state'), 'loading', 'visible document not preempted');
      assert.equal(await page.locator('#p25 iframe').count(), 0, 'offscreen loading slot preempted immediately');
      assert.ok(await page.locator('[data-preview-state="loading"]').count() <= 2);
      await page.waitForFunction(() => document.querySelector('#p26').dataset.previewState === 'ready');
      // Loading destinations can also be primed without leaving a permanent pin.
      await page.evaluate(() => { api.prioritizePreview(document.querySelector('#p24')); api.resetPreviews(); });
      for (const route of held) await route.abort().catch(() => {});
      held.length = 0;
      await page.evaluate(() => {
        document.querySelector('main').replaceChildren(); scrollTo(0, 0);
        for (const n of [24,25,26]) window.make(n).style.marginBottom = '400px';
        api.refreshPreviews();
      });
      await page.waitForFunction(() => document.querySelectorAll('[data-preview-state="loading"]').length === 2);
      await page.evaluate(() => {
        document.querySelector('#p26').scrollIntoView();
        api.prioritizePreview(document.querySelector('#p26'));
      });
      assert.equal(await page.locator('#p24 iframe').count(), 0, 'jump preempts farthest of two unrelated offscreen loads');
      assert.ok(await page.locator('[data-preview-state="loading"]').count() <= 2);
      await page.waitForFunction(() => document.querySelector('#p26').dataset.previewState === 'ready');
      // Ordinary scrolling gets the same preemption as minimap navigation.
      await page.evaluate(() => api.resetPreviews());
      for (const route of held) await route.abort().catch(() => {});
      held.length = 0;
      await page.evaluate(() => {
        document.querySelector('main').replaceChildren(); scrollTo(0, 0);
        for (const n of [24,25,26]) window.make(n).style.marginBottom = '400px';
        api.refreshPreviews();
      });
      await page.waitForFunction(() => document.querySelectorAll('[data-preview-state="loading"]').length === 2);
      await page.evaluate(() => { document.querySelector('#p26').scrollIntoView(); api.refreshPreviews(); });
      assert.equal(await page.locator('#p24 iframe').count(), 0, 'ordinary scroll also preempts unrelated offscreen loads');
      await page.waitForFunction(() => document.querySelector('#p26').dataset.previewState === 'ready');
      await page.evaluate(() => api.resetPreviews());
      for (const route of held) await route.abort().catch(() => {});
      await page.unroute(delayedPattern);
      // A timed-out offscreen preload retries once when scrolled into view.
      await page.evaluate(() => { document.querySelector('main').replaceChildren(); scrollTo(0, 0); });
      let returnRequests = 0;
      let secondRequest;
      const secondRequested = new Promise(resolve => { secondRequest = resolve; });
      await page.route('https://web.archive.org/web/20280101000000if_/**', route => {
        returnRequests++;
        if (returnRequests === 2) secondRequest();
        if (returnRequests <= 2) return; // Intentionally stalled documents.
        return route.fulfill({ contentType: 'text/html', body: '<p>Recovered on return</p>' });
      });
      await page.evaluate(() => { window.make(27).style.marginBottom = '400px'; window.returning = window.make(28); api.refreshPreviews(); });
      await page.waitForFunction(() => returning.dataset.previewState === 'loading');
      await page.clock.fastForward(20001);
      assert.equal(await page.locator('#p28').getAttribute('data-preview-state'), 'error');
      await page.evaluate(() => { returning.scrollIntoView(); api.refreshPreviews(); });
      await page.waitForFunction(() => document.querySelector('#p28 iframe')?.src && window.returning.dataset.previewState === 'loading');
      await secondRequested;
      await page.evaluate(() => returning.querySelector('iframe').dispatchEvent(new Event('error')));
      assert.equal(returnRequests, 2, 'viewport entry automatically recovers timed-out preload');
      await page.evaluate(() => { scrollTo(0, 0); api.refreshPreviews(); returning.scrollIntoView(); api.refreshPreviews(); });
      assert.equal(await page.locator('#p28').getAttribute('data-preview-state'), 'error', 'automatic retry is bounded even across repeated viewport entry');
      assert.equal(returnRequests, 2, 'no automatic retry storm');
      await page.locator('#p28 .preview-retry-button').click();
      await page.waitForFunction(() => returning.dataset.previewState === 'ready');
      assert.equal(returnRequests, 3, 'explicit retry still works after automatic retry is exhausted');
      await page.evaluate(() => api.resetPreviews());
      await page.unroute('https://web.archive.org/web/20280101000000if_/**');
      await page.evaluate(() => {
        window.cached = api.livePreview({archiveUrl:'https://web.archive.org/web/20270101000000/https://example.invalid/'}, 'cached', {manual:true});
        document.querySelector('main').append(cached); cached.scrollIntoView();
      });
      assert.equal(await page.locator('iframe').count(), 0);
      await page.locator('.preview-interact-button').last().click();
      assert.match(await page.locator('iframe').getAttribute('src'), /\/web\/20270101000000if_\//, 'cached archive URL normalized to toolbar-free replay');
    }
    await page.evaluate(() => {
      api.resetPreviews();
      for (const previewUrl of ['https://evil.invalid/', 'javascript:alert(1)', 'https://fixture.invalid/web/20200101000000/https://example.com', 'https://user:password@web.archive.org/web/20200101000000/https://example.com']) {
        document.body.append(api.livePreview({previewUrl}, 'bad'));
      }
    });
    assert.equal(await page.locator('iframe').count(), 0);
    assert.match(await page.locator('.live-status').last().textContent(), /Invalid archive/);
    assert.equal(await page.locator('#actions button').getAttribute('aria-pressed'), 'false');
    await page.close();
    console.log(`PASS deterministic preview scheduler: memory=${memory ?? 'unknown'}, saveData=${saveData}, residents<=${limit}, loads<=2, early preload, retained state, interaction/wheel/security/posters/cleanup`);
  }
} finally { await browser.close(); }

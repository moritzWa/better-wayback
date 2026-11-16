// Deterministic integration fixtures. No external archive traffic or renderer jobs.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';

const assets = new Set(['app.js', 'examples.js', 'previews.js', 'previews.css', 'timeline-nav.js', 'timeline-nav.css', 'style.css', 'logo.svg', 'favicon.svg']);
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? 'public/index.html' : path === '/group.js' ? 'group.js' : assets.has(path.slice(1)) ? `public${path}` : null;
  if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
  res.end(await readFile(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const capture = (year, text = `Version ${year} different words`) => ({ timestamp: `${year}0101000000`, original: 'https://fixture.test/', title: `Fixture ${year}`, text, image: '/fixture.svg', archiveUrl: `https://web.archive.org/web/${year}0101000000/https://fixture.test/` });
const demo = [capture(2000, 'Same version'), capture(2001, 'Same version'), ...[2004, 2008, 2012, 2016, 2020, 2024].map(y => capture(y))];
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let jobs = 0, replays = 0;
  await page.addInitScript(() => {
    window.fixtureStreams = [];
    window.EventSource = class { constructor() { window.fixtureStreams.push(this); } close() { this.closed = true; } };
    window.emit = (event, index = window.fixtureStreams.length - 1) => window.fixtureStreams[index].onmessage({ data: JSON.stringify(event) });
  });
  await page.route('**/api/demos/*', route => route.fulfill({ json: { url: route.request().url().endsWith('amazon') ? 'https://amazon.com/' : 'https://stripe.com/', total: 1000, sampled: demo.length, captures: demo, curated: true } }));
  await page.route('**/api/jobs', route => { jobs++; return route.fulfill({ json: { id: 'fixture', url: 'https://fixture.test/' } }); });
  await page.route('**/fixture.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="#eee"/></svg>' }));
  await page.route('https://web.archive.org/**', route => { replays++; return route.fulfill({ contentType: 'text/html', body: '<html><body style="height:2000px">Archive replay fixture</body></html>' }); });
  const emit = event => page.evaluate(event => window.emit(event), event);
  const points = page.locator('.timeline-nav-points a');
  const settled = () => page.waitForFunction(() => !document.querySelector('#search-button').disabled);
  const lastDestinationSettled = offset => page.waitForFunction(offset => {
    const last = document.querySelector('#timeline').lastElementChild;
    const target = Math.min(last.getBoundingClientRect().top + scrollY - offset, document.documentElement.scrollHeight - innerHeight);
    return Math.abs(scrollY - target) < 2;
  }, offset);
  const compactBottom = async () => {
    const gap = await page.locator('#timeline').evaluate(n => document.querySelector('.support-banner').getBoundingClientRect().top - n.lastElementChild.querySelector('.entry-card').getBoundingClientRect().bottom);
    assert.ok(gap <= 81, `No viewport-sized spacer after final preview (gap ${gap}px)`);
  };
  await page.goto(base); await settled();
  assert.equal(jobs, 0); assert.equal(replays, 0);
  assert.equal(await page.locator('iframe').count(), 0, 'PNG presets stay instant without iframe DOM/network');
  assert.equal(await points.count(), 7, 'Changes-only nav excludes grouped capture');
  assert.equal(await page.locator('.browser-chrome, .card-bottom, .entry-title').count(), 0);
  await page.locator('#all-view').click();
  assert.equal(await points.count(), 8);
  assert.equal(await page.locator('.timeline-nav-year').count(), 8, 'Annual captures retain one year label per group');
  assert.deepEqual(await page.locator('.timeline-nav-month').allTextContents(), Array(8).fill('Jan'), 'Sparse histories still show capture months');
  await page.locator('#timeline').evaluate(n => scrollTo(0, n.offsetTop));
  await page.waitForFunction(() => !document.querySelector('.timeline-nav').hidden);
  const pageGeometry = await page.locator('.page').boundingBox();
  const railGeometry = await page.locator('.timeline-nav').boundingBox();
  assert.ok(railGeometry.x + railGeometry.width < pageGeometry.x, 'Rail does not squeeze/overlap centered page');
  const beforeUrl = page.url(), beforeHistory = await page.evaluate(() => history.length);
  await page.setViewportSize({ width: 1440, height: 1800 });
  await compactBottom();
  await points.last().click();
  await lastDestinationSettled(24);
  await page.waitForFunction(() => [...document.querySelectorAll('.timeline-nav-points a')].at(-1).getAttribute('aria-current') === 'location');
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(page.url(), beforeUrl); assert.equal(await page.evaluate(() => history.length), beforeHistory);
  assert.equal(jobs, 0); assert.equal(replays, 0, 'Jump never activates a manual poster');
  await page.locator('.timeline-entry').nth(3).evaluate(n => scrollTo(0, n.getBoundingClientRect().top + scrollY - 24));
  await page.waitForFunction(() => document.querySelectorAll('.timeline-nav-points a')[3].hasAttribute('aria-current'));
  await page.evaluate(() => scrollTo(0, 0));
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.waitForFunction(() => document.querySelector('.timeline-nav').hidden);
  await page.setViewportSize({ width: 1440, height: 900 });

  // New searches cancel old streams and replace, rather than retain, anchors.
  await page.locator('#url').fill('fixture.test'); await page.locator('#search-form').evaluate(n => n.requestSubmit());
  await page.waitForFunction(() => window.fixtureStreams.length === 1);
  const selected = [capture(1999), capture(2002), capture(2007), capture(2018)];
  await emit({ type: 'index', total: 10, sampled: 4, captures: selected });
  assert.equal(await points.count(), 4);
  assert.equal(await page.locator('.timeline-nav-points a[data-state="pending"]').count(), 4);
  assert.match(await points.first().getAttribute('aria-label'), /Jan 1, 1999.*pending/);
  await emit({ type: 'capture', capture: selected[0] });
  await page.locator('#timeline').evaluate(n => scrollTo(0, n.offsetTop));
  await points.first().focus();
  await points.first().evaluate(n => { window.savedPoint = n; window.savedCard = document.querySelector('.timeline-entry'); window.savedPoster = window.savedCard.querySelector('img'); window.savedInteract = window.savedCard.querySelector('.preview-interact-button'); });
  await emit({ type: 'capture', capture: { ...selected[0], text: 'Updated HTML metadata', textSource: 'html' } });
  assert.equal(await points.first().evaluate(n => n === window.savedPoint && n === document.activeElement), true, 'Metadata updates preserve nav DOM and focus');
  assert.equal(await page.locator('.timeline-entry').first().evaluate(n => n === window.savedCard && n.querySelector('img') === window.savedPoster && n.querySelector('.preview-interact-button') === window.savedInteract), true);
  await points.nth(2).focus();
  await points.nth(2).evaluate(n => { window.survivingPoint = n; });
  await emit({ type: 'capture', capture: { ...selected[1], error: 'Fixture unavailable' } });
  assert.equal(await points.count(), 3, 'Confirmed failure leaves the date navigation immediately');
  assert.equal(await page.locator('.timeline-nav-year').filter({ hasText: '2002' }).count(), 0, 'Removing the last capture removes its year group');
  assert.equal(await points.nth(1).evaluate(n => n === window.survivingPoint && n === document.activeElement), true, 'Removing an earlier year preserves focus in surviving groups');
  assert.equal(await page.locator('.timeline-entry[data-capture^="2002"]').count(), 0);
  assert.equal(await page.locator('.entry-pending').count(), 2, 'Unresolved captures remain visible');
  await emit({ type: 'capture', capture: selected[2] });
  await emit({ type: 'done' });
  assert.equal(await page.locator('.timeline-nav-points a[data-state="unavailable"]').count(), 0);
  assert.equal(await points.count(), 2, 'Failed and unfinished captures have no date points after completion');

  // Every action is in the date row. The original preview button still toggles.
  const entry = page.locator('.timeline-entry').first();
  assert.equal(await entry.locator('.entry-meta .preview-interact-button').count(), 1);
  await entry.locator('.preview-interact-button').click();
  await entry.locator('iframe').waitFor();
  assert.equal(await entry.locator('.preview-interact-button').innerText(), 'Done');
  await entry.locator('.preview-interact-button').click();
  assert.equal(await entry.locator('.preview-interact-button').innerText(), 'Interact');

  // Mobile picker stays within 320px and scrolls beneath itself.
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#timeline').evaluate(n => scrollTo(0, n.offsetTop));
    await page.locator('.timeline-year-picker select').selectOption({ index: 1 });
    await lastDestinationSettled(76);
    await compactBottom();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px overflow`);
    assert.equal(await page.locator('.timeline-nav-points').isVisible(), false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-site="amazon.com"]').click(); await settled();
  assert.equal(await page.locator('.timeline-nav-points a[aria-label*="1999"]').count(), 0, 'New search clears stale anchors');
  await emit({ type: 'capture', capture: capture(1996) });
  assert.equal(await page.locator('.timeline-nav-points a[aria-label*="1996"]').count(), 0, 'Cancelled stream cannot repopulate nav');
  await page.goBack(); await page.waitForFunction(() => window.fixtureStreams.length === 2);
  assert.equal(await page.locator('#url').inputValue(), 'fixture.test');
  await emit({ type: 'error', message: 'Fixture stopped' });
  await page.goForward(); await settled();
  assert.equal(await page.locator('#url').inputValue(), 'amazon.com');

  // Prove destination priming occurs before a smooth scroll, without moving first.
  await page.locator('#url').fill('live-fixture.test'); await page.locator('#search-form').evaluate(n => n.requestSubmit());
  await page.waitForFunction(() => window.fixtureStreams.length === 3);
  const live = demo.map(c => { const { image, ...rest } = c; return { ...rest, previewUrl: rest.archiveUrl }; });
  await emit({ type: 'index', total: 8, sampled: 8, captures: live });
  for (const c of live) await emit({ type: 'capture', capture: c });
  await emit({ type: 'done' });
  await page.locator('#timeline').evaluate(n => scrollTo(0, n.offsetTop));
  await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(n => n.contentWindow));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { window.originalScroll = window.scrollTo; window.scrollTo = options => { window.jumpOptions = options; window.primedBeforeScroll = Boolean(document.querySelector('#timeline').lastElementChild.querySelector('iframe[src]')); }; });
  await points.last().click();
  assert.equal(await page.evaluate(() => window.primedBeforeScroll), true);
  assert.equal(await page.evaluate(() => window.jumpOptions.behavior), 'smooth');
  await page.evaluate(() => { window.scrollTo = window.originalScroll; });
  // A dense short desktop rail must reveal its active point without scrolling
  // any ancestor (especially the outer document).
  const dense = Array.from({ length: 40 }, (_, i) => {
    const year = 2000 + Math.floor(i / 4) * 2;
    const timestamp = `${year}${['0312', '0326', '0608', '1119'][i % 4]}000000`;
    return { ...capture(year, `Distinct version ${i} for capture ${timestamp}`), timestamp, archiveUrl: `https://web.archive.org/web/${timestamp}/https://fixture.test/` };
  });
  await page.route('**/api/demos/*', route => route.fulfill({ json: { url: 'https://stripe.com/', total: dense.length, sampled: dense.length, captures: dense, curated: true } }));
  await page.locator('[data-site="stripe.com"]').click(); await settled();
  await page.locator('#all-view').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 420 });
  assert.equal(await points.count(), 40);
  assert.equal(await page.locator('.timeline-nav-year').count(), 10, 'One year label for each group of four captures');
  assert.deepEqual(await page.locator('.timeline-nav-group').first().locator('.timeline-nav-month').allTextContents(), ['Mar 12', 'Mar 26', 'Jun', 'Nov'], 'Only repeated months gain day labels');
  assert.equal(await page.locator('.timeline-nav-year').filter({ hasText: '2001' }).count(), 0, 'Skipped years do not create empty groups');
  assert.match(await points.first().getAttribute('aria-label'), /Mar 12, 2000/);
  const outerY = await page.locator('#timeline').evaluate(n => { const last = n.lastElementChild; scrollTo(0, last.getBoundingClientRect().top + scrollY - 24); return scrollY; });
  await page.waitForFunction(() => [...document.querySelectorAll('.timeline-nav-points a')].at(-1).hasAttribute('aria-current'));
  const activeRail = await page.locator('.timeline-nav-points').evaluate(n => {
    const rail = n.getBoundingClientRect(), active = n.querySelector('[aria-current]').getBoundingClientRect();
    return { scrollTop: n.scrollTop, visible: active.top >= rail.top - 1 && active.bottom <= rail.bottom + 1 };
  });
  assert.ok(activeRail.scrollTop > 0, 'Dense rail scrolls internally');
  assert.equal(activeRail.visible, true, 'Last active dot stays visible in short desktop viewport');
  assert.equal(await page.evaluate(() => scrollY), outerY, 'Rail auto-reveal never moves outer document');
  const stickyYear = await page.locator('.timeline-nav-points').evaluate(n => {
    const group = n.querySelectorAll('.timeline-nav-group')[5];
    n.scrollTop = group.offsetTop + 48;
    const year = group.querySelector('.timeline-nav-year').getBoundingClientRect(), rail = n.getBoundingClientRect();
    return { top: year.top - rail.top, groupTop: group.getBoundingClientRect().top - rail.top };
  });
  assert.ok(stickyYear.groupTop < 0 && stickyYear.top >= 0 && stickyYear.top <= 15, `Year sticks inside its scrolling group: ${JSON.stringify(stickyYear)}`);
  assert.equal(await page.evaluate(() => scrollY), outerY, 'Manual rail scrolling never moves the page');
  await page.setViewportSize({ width: 1180, height: 900 });
  const edgeGeometry = await page.locator('.timeline-nav').boundingBox();
  assert.ok(edgeGeometry.x >= 0 && edgeGeometry.x + edgeGeometry.width < (await page.locator('.page').boundingBox()).x, 'Wider year/month rail fits at smallest desktop breakpoint');
  await page.setViewportSize({ width: 1440, height: 900 });
  await points.nth(20).click();
  await page.waitForFunction(() => document.querySelectorAll('.timeline-nav-points a')[20].hasAttribute('aria-current'));
  // Streaming/grouping can change which dates need day labels, without
  // replacing the focused link or leaving behind an empty year group.
  await page.locator('#url').fill('single-year.test'); await page.locator('#search-form').evaluate(n => n.requestSubmit());
  await page.waitForFunction(() => window.fixtureStreams.length === 4);
  const singleYear = dense.slice(0, 3);
  await emit({ type: 'index', total: 3, sampled: 3, captures: singleYear });
  assert.equal(await page.locator('.timeline-nav-year').count(), 1);
  assert.deepEqual(await page.locator('.timeline-nav-month').allTextContents(), ['Mar 12', 'Mar 26', 'Jun']);
  await page.locator('#timeline').evaluate(n => scrollTo(0, n.offsetTop));
  await points.first().focus();
  await points.first().evaluate(n => { window.singleYearPoint = n; });
  await emit({ type: 'capture', capture: { ...singleYear[1], error: 'Fixture unavailable' } });
  assert.deepEqual(await page.locator('.timeline-nav-month').allTextContents(), ['Mar', 'Jun']);
  assert.equal(await points.first().evaluate(n => n === window.singleYearPoint && n === document.activeElement), true, 'Day-label changes preserve focus and link identity');
  for (const c of [singleYear[0], singleYear[2]]) await emit({ type: 'capture', capture: c });
  await emit({ type: 'done' });
  await mkdir('test-output', { recursive: true });
  await page.screenshot({ path: 'test-output/timeline-desktop.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: grouped year/month rail, repeated-month days, sticky years, annual and dense histories, 1180px gutter, stable focus/DOM, active scrolling, preview priming, pending/errors, cancellation, Back/Forward, 320/390 picker, zero preset iframe/jobs.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

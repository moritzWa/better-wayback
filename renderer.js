import { cleanText, replayUrl, USER_AGENT } from './lib.js';

export const ARCHIVE_CHROME_CSS = '#wm-ipp-base, #wm-ipp-print, #donato, .wb-autocomplete-suggestions { display:none!important; } html { scroll-behavior:auto!important; }';

export function archiveRequestAllowed(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && url.hostname === 'web.archive.org' && !url.username && !url.password && !url.port;
  } catch { return false; }
}

export async function isolatedContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: USER_AGENT, serviceWorkers: 'block', acceptDownloads: false });
  // Archived scripts are untrusted. Never permit live-site or local-network fallback.
  await context.route('**/*', route => archiveRequestAllowed(route.request().url()) ? route.continue() : route.abort());
  // Routing HTTP alone does not stop script-created WebSocket connections.
  await context.routeWebSocket('**/*', socket => socket.close());
  context.on('page', page => {
    page.on('dialog', dialog => dialog.dismiss());
    page.on('popup', popup => popup.close());
  });
  return context;
}

// Installed before navigation so late styles/scripts/fonts cannot appear to be ready.
export function trackReadiness(page) {
  const pending = new Set();
  let lastActivity = Date.now();
  const relevant = request => ['document', 'stylesheet', 'script', 'font', 'image'].includes(request.resourceType());
  const start = request => { if (relevant(request)) { pending.add(request); lastActivity = Date.now(); } };
  const end = request => { if (pending.delete(request)) lastActivity = Date.now(); };
  page.on('request', start);
  page.on('requestfinished', end);
  page.on('requestfailed', end);
  return {
    quiet: () => pending.size === 0 && Date.now() - lastActivity >= 500,
    pending: () => [...pending].map(request => request.url()),
    dispose() { page.off('request', start); page.off('requestfinished', end); page.off('requestfailed', end); },
  };
}

export async function waitForCaptureReady(page, activity, { timeoutMs = 15000 } = {}) {
  const started = Date.now();
  let stableSince = Date.now(), previous = '', last;
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(() => {
      const inViewport = el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      };
      const visible = el => {
        for (let node = el; node instanceof Element; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.visibility !== 'visible' || Number(style.opacity) < 0.05) return false;
        }
        return true;
      };
      // Wait for real entrance animations. Infinite decorative effects must not stall a capture.
      const finiteAnimations = document.getAnimations().filter(animation => {
        const target = animation.effect?.target;
        const timing = animation.effect?.getComputedTiming();
        return (animation.playState === 'running' || animation.pending) && Number.isFinite(timing?.endTime) && target instanceof Element && inViewport(target);
      }).length;
      const headings = [...document.querySelectorAll('h1,h2,[role="heading"]')].filter(inViewport);
      const hiddenHeadings = headings.filter(el => !visible(el)).length;
      const visibleHeadings = headings.filter(visible).map(el => el.textContent.trim());
      const imagesPending = [...document.images].filter(el => inViewport(el) && visible(el) && !el.complete).length;
      const text = document.body?.innerText || '';
      const infiniteTargets = new Set(document.getAnimations().filter(a => !Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.effect?.target));
      // Framer/Motion and similar libraries animate inline styles with requestAnimationFrame,
      // not Web Animations. Text becoming barely visible is not the end of that reveal.
      const content = new Set();
      for (const el of [...document.querySelectorAll('h1,h2,h3,p,a,button,img,[role="heading"],span')].filter(inViewport).slice(0, 600)) {
        // Include ancestor fades/masks. Exclude unrelated, continuously moving artwork.
        for (let node = el; node instanceof Element; node = node.parentElement) content.add(node);
      }
      const visual = [...content].map(el => {
        const style = getComputedStyle(el);
        return infiniteTargets.has(el) ? [style.visibility] : [style.visibility, style.opacity, style.transform, style.clipPath, style.filter, style.maskImage];
      });
      return { finiteAnimations, hiddenHeadings, visibleHeadings, imagesPending, fontsReady: document.fonts.status === 'loaded', textLength: text.trim().length, signature: JSON.stringify([visibleHeadings, text, document.body?.getBoundingClientRect().height, visual]) };
    });
    if (last.signature !== previous) { previous = last.signature; stableSince = Date.now(); }
    if (activity.quiet() && !last.finiteAnimations && !last.hiddenHeadings && !last.imagesPending && last.fontsReady && Date.now() - stableSince >= 500) {
      return { waitMs: Date.now() - started, ...last, signature: undefined, timedOut: false };
    }
    // A bounded sampling interval, not a fixed post-navigation sleep.
    await page.waitForTimeout(100);
  }
  // A text-rich DOM is not evidence of a finished image. Do not persist partial reveals.
  throw new Error(`Archive did not finish revealing and settling visible content before the render deadline (hidden headings: ${last?.hiddenHeadings}, animations: ${last?.finiteAnimations}, pending assets: ${activity.pending().length})`);
}

export async function renderCapture(browser, capture, screenshotPath, { readinessTimeoutMs } = {}) {
  const context = await isolatedContext(browser);
  const deadline = setTimeout(() => { void context.close().catch(() => {}); }, 65000);
  try {
    const page = await context.newPage();
    return await renderPage(page, capture, screenshotPath, { readinessTimeoutMs });
  } finally { clearTimeout(deadline); await context.close(); }
}

export async function renderPage(page, capture, screenshotPath, { readinessTimeoutMs } = {}) {
  const started = Date.now();
  const activity = trackReadiness(page);
  try {
    const response = await page.goto(replayUrl(capture.timestamp, capture.original), { waitUntil: 'domcontentloaded', timeout: 35000 });
    if (response && response.status() >= 400) throw new Error(`Archive returned HTTP ${response.status()}`);
    const navigationMs = Date.now() - started;
    await page.addStyleTag({ content: ARCHIVE_CHROME_CSS });
    const readiness = await waitForCaptureReady(page, activity, { timeoutMs: readinessTimeoutMs });
    const text = cleanText(await page.locator('body').innerText({ timeout: 5000 }));
    if (/Your IP address has reached|Rate limit exceeded/i.test(text)) throw new Error('Archive rate limit exceeded. Try again later.');
    if (text.length < 60 || /Wayback Machine has not archived that URL|This URL has been excluded|The Wayback Machine has not archived/i.test(text)) throw new Error('Incomplete or unavailable archive replay');
    const actualTimestamp = page.url().match(/\/web\/(\d{14})/)?.[1] || capture.timestamp;
    const title = (await page.title()).replace(/\s*[-|]\s*Wayback Machine$/, '');
    // Keep animations intact: cancelling a CSS reveal can restore its invisible base style.
    await page.screenshot({ path: screenshotPath, animations: 'allow', timeout: 10000 });
    return { ...capture, timestamp: actualTimestamp, requestedTimestamp: capture.timestamp, text, title, archiveUrl: replayUrl(actualTimestamp, capture.original), timing: { navigationMs, totalMs: Date.now() - started, readiness } };
  } finally { activity.dispose(); }
}

export async function runPool(items, limit, run) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await run(items[next++]);
  }));
}

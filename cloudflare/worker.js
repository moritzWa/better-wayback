import { launch } from '@cloudflare/playwright';
import { isolatedContext, renderPage } from '../.cache/cloudflare-runtime/renderer.js';
import { handleSupportRequest } from '../support.mjs';
import { createRuntime } from './runtime.js';
import { extractHtml } from './html.js';
import { handleAnalytics } from './analytics.js';
export { QuotaCoordinator } from './quota.js';

const handle = createRuntime({
  launch,
  extractHtml,
  async render(browser, capture) {
    // The shared readiness implementation preserves Harvey reveals and Wikipedia's
    // intentionally hidden accessibility labels. No local browser launch or disk I/O.
    const context = await isolatedContext(browser);
    try {
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(12000);
      return await renderPage(page, capture, undefined, { readinessTimeoutMs: 8000 });
    } finally { await context.close(); }
  },
});

export default {
  async fetch(request, env) {
    try {
      const analytics = await handleAnalytics(request, env);
      if (analytics) return analytics;
      const support = await handleSupportRequest(request, env);
      return support || await handle(request, env);
    } catch { return Response.json({ error: 'Runtime unavailable. Packaged examples remain available.' }, { status: 503 }); }
  },
};

import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { handleBlogRequest, blogSitemapEntries, blogScriptHashes } from '../blog.js';

const root = resolve('.cache/cloudflare-assets');
const put = async (path, body) => { const file = resolve(root, path.replace(/^\//, '')); await mkdir(dirname(file), { recursive: true }); await writeFile(file, body); };
// Only this build's generated directory is replaced, never public or the Node cache.
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await cp('public', root, { recursive: true });
await cp('group.js', resolve(root, 'group.js'));
for (const name of ['stripe', 'amazon']) await put(`/api/demos/${name}`, await readFile(`demos/${name}.json`));
const blogPaths = ['/robots.txt', '/sitemap.xml', '/blog/style.css', ...blogSitemapEntries.map(entry => entry.path)];
for (const path of blogPaths) {
  const page = handleBlogRequest(path);
  if (!page || page.status !== 200) throw new Error(`Static blog build failed: ${path}`);
  await put(path.endsWith('/') ? `${path}index.html` : path, page.body);
}
await put('/404.html', '<!doctype html><title>Not found | Visual Wayback</title><h1>Not found</h1><a href="/">Visual Wayback</a>');
const csp = `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' https://challenges.cloudflare.com ${blogScriptHashes.join(' ')}; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
await put('/_headers', `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: ${csp}\n/blog/*\n  Content-Security-Policy: default-src 'none'; style-src 'self'; script-src 'self' https://challenges.cloudflare.com ${blogScriptHashes.join(' ')}; connect-src 'self'; frame-src https://challenges.cloudflare.com; base-uri 'none'; frame-ancestors 'none'; form-action 'none'\n/api/demos/*\n  Content-Type: application/json\n  Cache-Control: public, max-age=300\n/demos/*\n  Cache-Control: public, max-age=31536000, immutable\n`);

// Reuse the exact local renderer, not a second readiness/security implementation.
// Fail the build if upstream source changes invalidate these narrow transformations.
let renderer = await readFile('renderer.js', 'utf8');
function replaceOnce(before, after) {
  if (renderer.split(before).length !== 2) throw new Error(`Shared renderer extraction needs review: ${before}`);
  renderer = renderer.replace(before, after);
}
replaceOnce("import { chromium } from 'playwright';\n", '');
replaceOnce("from './lib.js'", "from '../../lib.js'");
replaceOnce("export function launchRendererBrowser(browserType = chromium) {\n  return browserType.launch({ headless: true, chromiumSandbox: true, args: ['--mute-audio'] });\n}", '');
replaceOnce("timeout: 35000", "timeout: 12000");
replaceOnce("await page.screenshot({ path: screenshotPath, animations: 'allow', timeout: 10000 });", "const png = await page.screenshot({ animations: 'allow', timeout: 5000 });");
replaceOnce('return { ...capture, timestamp: actualTimestamp', 'return { ...capture, png, timestamp: actualTimestamp');
await mkdir('.cache/cloudflare-runtime', { recursive: true });
await writeFile('.cache/cloudflare-runtime/renderer.js', renderer);
console.log(`Built static assets, ${blogSitemapEntries.length} blog routes, two offline demos and shared renderer.`);

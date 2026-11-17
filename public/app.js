import { groupCaptures, similarity, comparableText } from '/group.js';
import { livePreview, refreshPreviews, resetPreviews, prioritizePreview, takePreviewStats } from '/previews.js';
import { timelineNavigation } from '/timeline-nav.js';
import { exampleForSite } from '/examples.js';
import { requestSearchJob } from '/search-request.js';
// A blocked analytics module must not prevent the app itself from loading.
let tracking;
const trackingQueue = [];
const analytics = Object.fromEntries(['begin', 'cache', 'ready', 'failed', 'preview', 'previews'].map(name => [name, (...args) => {
  if (tracking) tracking[name]?.(...args);
  else if (trackingQueue.length < 100) trackingQueue.push([name, args]);
}]));
void import('/analytics.js').then(({ createAnalytics }) => {
  tracking = createAnalytics();
  for (const [name, args] of trackingQueue) tracking[name](...args);
  trackingQueue.length = 0;
}).catch(() => { tracking = {}; trackingQueue.length = 0; });
document.addEventListener('click', event => {
  if (event.target.closest?.('#timeline .preview-interact-button, #timeline .preview-interaction-shield, #timeline a[target="_blank"]')) analytics.preview();
}, true);
const flushPreviewStats = () => analytics.previews(takePreviewStats());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPreviewStats(); });
addEventListener('pagehide', flushPreviewStats);

const $ = id => document.getElementById(id);
let captures = [], changesOnly = true, total = 0, sampled = 0, capped = false, running = false, stream;
let requested = [], indexed = false, generation = 0;
let resumeTimer;
let screenshotStream, screenshotTimer, screenshotPath;
let lookupAbort, indexFailed = false;
let indexLabel;
const entries = new Map();
const navigation = timelineNavigation($('timeline'), prioritizePreview);
const captureKey = capture => `${capture.requestedTimestamp || capture.timestamp}:${capture.original}`;
const captureOrder = capture => capture.requestedTimestamp || capture.timestamp;
const date = stamp => new Date(`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
function samplingNote(text = '') { $('sampling-note').textContent = text; $('sampling-note').hidden = !text; }
function render() {
  const groups = groupCaptures(captures, Number($('sensitivity').value) / 100);
  const pending = running ? (requested.length ? requested : Array.from({ length: Number($('count').value) }, (_, i) => ({ slot: i, original: $('url').value }))).filter(c => !captures.some(result => captureKey(result) === captureKey(c))) : [];
  // Keep pending slots until resolved, but never leave confirmed failures as cards.
  const usable = captures.filter(c => !c.error);
  const visible = running ? [...usable, ...pending.map(c => ({ ...c, pending: true }))] : changesOnly ? groups : usable.map(c => ({ ...c, count: 1 }));
  visible.sort((a, b) => (captureOrder(a) || '').localeCompare(captureOrder(b) || '') || (a.slot || 0) - (b.slot || 0));
  const failed = captures.filter(c => c.error).length;
  const knownGroups = groups.filter(c => comparableText(c, c)).length;
  const unCompared = captures.filter(c => !c.error && !comparableText(c, c)).length;
  $('stats').textContent = indexed ? `${indexLabel || (capped ? '1,200+ indexed' : `${total.toLocaleString()} indexed`)} · ${captures.length}/${sampled} sampled · ${knownGroups} text versions${unCompared ? ` · ${unCompared} not compared` : ''}${running ? ` · ${Math.max(0, sampled - captures.length)} pending` : ''}${failed ? ` · ${failed} unavailable` : ''}` : indexFailed ? 'Archive index lookup failed.' : 'Finding archived captures…';
  if ($('error').dataset.partialResults) {
    $('error').hidden = !failed;
    $('error').textContent = `Partial results: ${failed} of ${sampled} sampled captures could not be loaded. Available previews are shown below.`;
  }
  $('sensitivity-value').textContent = $('sensitivity').value + '%';
  $('empty-state').hidden = running || indexFailed || visible.length > 0;
  let previous, position = 0;
  const visibleKeys = new Set(), navItems = [];
  for (const capture of visible) {
    const currentSite = capture.sourceType === 'live';
    const key = capture.timestamp ? captureKey(capture) : `finding-${capture.slot}`;
    visibleKeys.add(key);
    let entry = entries.get(key);
    if (!entry) {
      entry = el('article', 'timeline-entry');
      entry.dataset.capture = key;
      entry.id = `capture-${encodeURIComponent(key)}`;
      const meta = el('div', 'entry-meta'), details = el('div', 'entry-details');
      details.append(el('div', 'entry-date'), el('div', 'entry-month'), el('div', 'entry-badge'), el('div', 'entry-count'));
      const actions = el('div', 'card-actions'), button = el('button', 'compare-button', 'Compare text'); button.type = 'button';
      const open = el('a', 'archive-link'); open.target = '_blank'; open.rel = 'noopener';
      actions.append(button, open); meta.append(details, actions); entry.append(meta);
      entries.set(key, entry);
    }
    const meta = entry.querySelector('.entry-meta'), actions = meta.querySelector('.card-actions');
    meta.querySelector('.entry-date').textContent = currentSite ? 'Current' : capture.timestamp ? capture.timestamp.slice(0, 4) : 'Finding capture';
    meta.querySelector('.entry-month').textContent = capture.timestamp ? date(capture.timestamp) : `Sample ${capture.slot + 1}`;
    const difference = comparableText(previous, capture) && !capture.error && !capture.pending ? Math.round((1 - similarity(previous.text, capture.text)) * 100) : null;
    const noDifference = !previous ? 'FIRST SEEN' : (previous.textSource || 'rendered') !== (capture.textSource || 'rendered') ? 'DIFFERENT TEXT SOURCES' : 'NO PREVIOUS TEXT';
    meta.querySelector('.entry-badge').textContent = currentSite ? 'LIVE SITE CAPTURE · NOT AN ARCHIVE REPLAY' : capture.pending ? 'PENDING' : capture.error ? 'UNAVAILABLE' : capture.textPending ? 'READING HTML' : capture.comparisonUnavailable || capture.textTruncated ? 'TEXT UNAVAILABLE' : difference === null ? noDifference : `${difference}% TEXT DIFFERENCE`;
    const count = meta.querySelector('.entry-count'); count.hidden = !(capture.count > 1);
    count.textContent = capture.count > 1 ? `${capture.count} similar sampled captures\nthrough ${date(capture.lastTimestamp)}` : '';
    // Reserve the same action-row height while a sample is pending.
    actions.style.visibility = capture.pending || capture.error ? 'hidden' : '';
    actions.inert = Boolean(capture.pending || capture.error);
    const open = actions.querySelector('.archive-link'); open.href = capture.archiveUrl || '#'; open.textContent = currentSite ? 'Open current site ↗' : 'Open archive ↗';
    // Only rebuild a preview when its own data changes, never for another SSE result.
    const signature = JSON.stringify([capture.pending, capture.image, capture.previewUrl, capture.error, capture.original, capture.sourceType]);
    let card = entry.querySelector('.entry-card');
    if (!card || entry.dataset.signature !== signature || card.querySelector('[data-preview-disposed]')) {
      const oldCard = card;
      card = el('div', 'entry-card');
      actions.querySelector('.preview-interact-button')?.remove();
      if (capture.pending) {
        entry.setAttribute('aria-busy', 'true');
        const skeleton = el('div', 'entry-pending');
        const lines = el('div', 'skeleton-lines'); lines.setAttribute('aria-hidden', 'true'); lines.append(el('i'), el('i'), el('i'));
        skeleton.append(lines, el('span', '', indexed ? 'Waiting for archived preview…' : 'Looking up archived dates…'));
        card.append(skeleton);
      } else if (capture.error) {
        entry.removeAttribute('aria-busy');
        card.append(el('div', 'entry-error', capture.error + ' Other results are kept.'));
      }
      else {
        entry.removeAttribute('aria-busy');
        if (capture.image && currentSite) {
          const link = el('a', 'preview-link'); link.href = capture.archiveUrl; link.target = '_blank'; link.rel = 'noopener';
          const image = el('img'); image.src = capture.image; image.alt = `${capture.title || capture.original}, ${currentSite ? 'live site captured' : 'archived'} ${date(capture.timestamp)}`; image.loading = 'lazy'; link.append(image); card.append(link);
        } else {
          const preview = livePreview(capture, `${capture.title || capture.original}, archived ${date(capture.timestamp)}`, capture.image ? { poster: capture.image, manual: true } : {});
          card.append(preview);
          const interact = preview.querySelector('.preview-interact-button');
          if (interact) actions.insertBefore(interact, open);
        }
      }
      if (oldCard) oldCard.replaceWith(card); else entry.append(card);
      entry.dataset.signature = signature;
    }
    for (const link of card.querySelectorAll('.preview-link')) link.href = capture.archiveUrl;
    let textStatus = card.querySelector('.text-status');
    if (capture.comparisonUnavailable && !capture.textPending && !capture.error) {
      if (!textStatus) { textStatus = el('p', 'text-status'); card.append(textStatus); }
      textStatus.textContent = capture.textError || (capture.textTruncated ? 'HTML text is too long for a complete comparison.' : 'Little or no text in the archived HTML. JavaScript may supply the visible content.');
    } else textStatus?.remove();
    const button = actions.querySelector('.compare-button');
    if (button) {
      const before = previous;
      button.hidden = !comparableText(before, capture);
      button.onclick = () => compare(before, capture);
    }
    if (!capture.error && !capture.pending) previous = capture;
    // insertBefore only when necessary; existing image nodes stay connected.
    const current = $('timeline').children[position];
    if (current !== entry) $('timeline').insertBefore(entry, current || null);
    const state = capture.pending ? 'pending' : capture.error ? 'unavailable' : currentSite ? 'current site' : 'archived';
    navItems.push({ entry, timestamp: capture.timestamp, year: currentSite ? 'Now' : capture.timestamp?.slice(0, 4) || '…', label: `${capture.timestamp ? date(capture.timestamp) : `Sample ${capture.slot + 1}`} · ${state}`, state });
    position++;
  }
  for (const entry of [...$('timeline').children]) if (!visibleKeys.has(entry.dataset.capture)) entry.remove();
  navigation.update(navItems);
  refreshPreviews();
}
function compare(before, after) {
  document.querySelector('.compare-note').textContent = before.textSource === 'html' ? 'Compares page text, including collapsed sections, not visual appearance. JavaScript-only text can be missing; responsive duplicates are removed.' : 'Text lines are compared, not image pixels. Reflowed text can appear as an edit.';
  $('compare-title').textContent = `${date(before.timestamp)} → ${date(after.timestamp)}`;
  const container = el('div', 'diff-columns');
  const lines = [before.text.split('\n'), after.text.split('\n')];
  for (let i = 0; i < 2; i++) {
    const panel = el('div', 'diff-panel'); panel.append(el('div', 'diff-date', i ? 'AFTER · Added or changed text' : 'BEFORE · Removed or changed text'));
    const text = el('div', 'diff-text'); const other = new Set(lines[1-i]);
    for (const line of lines[i]) text.append(el('span', other.has(line) ? '' : i ? 'added' : 'removed', line + '\n'));
    panel.append(text); container.append(panel);
  }
  $('comparison').replaceChildren(container); $('compare-dialog').showModal();
}
function finish() {
  clearTimeout(resumeTimer);
  // Account for unfinished samples even though failed cards are omitted.
  for (const capture of requested) if (!captures.some(result => captureKey(result) === captureKey(capture))) captures.push({ ...capture, error: 'No preview returned for this capture. Try again to load it.' });
  for (const capture of captures) if (capture.textPending) { capture.textPending = false; capture.comparisonUnavailable = !capture.text?.trim(); capture.textError = 'HTML lookup did not finish. Preview remains available.'; }
  running = false; $('search-button').disabled = false; $('progress').hidden = true; render();
  if (captures.some(c => !c.error && !c.pending)) analytics.ready();
  else analytics.failed();
  const failed = captures.filter(c => c.error).length;
  if (failed && $('error').hidden) { $('error').dataset.partialResults = 'true'; $('error').textContent = `Partial results: ${failed} of ${sampled} sampled captures could not be loaded. Available previews are shown below.`; $('error').hidden = false; }
}
function onEvent(event) {
  if (event.type === 'status') $('status').textContent = event.message;
  if (event.type === 'index') {
    indexed = true; total = event.total; sampled = event.sampled; capped = event.capped;
    if (event.timeSampled) indexLabel = 'Time-sampled index';
    if (event.indexWarning) { delete $('error').dataset.partialResults; $('error').textContent = event.indexWarning; $('error').hidden = false; }
    requested = event.captures || [];
    if (event.firstTimestamp) $('from').placeholder = event.firstTimestamp.slice(0, 4);
    if (event.lastTimestamp) $('to').placeholder = event.lastTimestamp.slice(0, 4);
    $('status').textContent = `Loading ${sampled} archived previews…`;
    render();
  }
  if (event.type === 'capture') {
    if (typeof event.cached === 'boolean') analytics.cache(event.cached ? 'yes' : 'no');
    const index = captures.findIndex(c => captureKey(c) === captureKey(event.capture));
    if (index < 0) captures.push(event.capture); else captures[index] = event.capture;
    captures.sort((a, b) => captureOrder(a).localeCompare(captureOrder(b)) || captureKey(a).localeCompare(captureKey(b)));
    $('progress-fill').style.width = `${sampled ? Math.min(100, captures.length / sampled * 100) : 0}%`;
    $('status').textContent = `${captures.length} of ${sampled} previews returned. ${Math.max(0, sampled - captures.length)} pending.`;
    render();
  }
  if (event.type === 'done') { stream?.close(); finish(); if (screenshotPath) warmScreenshots(screenshotPath, generation); }
  if (event.type === 'error') { analytics.failed(/quota|allowance|budget|429/i.test(event.message || '')); indexFailed = !indexed; stream?.close(); delete $('error').dataset.partialResults; $('error').textContent = event.message + (Number.isFinite(event.retryAfter) && event.retryAfter > 0 ? ` Try again in ${Math.ceil(event.retryAfter / 60)} minutes.` : ''); $('error').hidden = false; finish(); }
}
function connectStream(path, current, attempts = 0) {
  if (current !== generation || !running) return;
  const connection = new EventSource(path);
  stream = connection;
  connection.onmessage = message => {
    if (current !== generation || stream !== connection || !running) return;
    let event;
    try { event = JSON.parse(message.data); } catch { connection.close(); onEvent({ type: 'error', message: 'Invalid renderer response. Available previews are kept.' }); return; }
    const coolingDown = event.type === 'error' && Number.isFinite(event.retryAfter) && event.retryAfter > 0 && event.retryAfter <= 90 && /cooling down|rate limit|429/i.test(event.message || '');
    if (event.type === 'continue' || coolingDown) {
      connection.close();
      if (attempts >= 24) { onEvent({ type: 'error', message: 'Rendering paused after repeated retries. Available previews are kept. Search again later.' }); return; }
      // Free-tier rendering advances one capture per connection. Never reconnect in a busy loop.
      const seconds = Math.max(coolingDown || event.source === 'html' ? 1 : 20, Math.min(3600, Number(event.retryAfter) || 90));
      $('status').textContent = `${captures.length} of ${sampled} previews returned. Continuing in ${Math.ceil(seconds)} seconds…`;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => connectStream(path, current, attempts + 1), seconds * 1000);
      return;
    }
    onEvent(event);
  };
  connection.onerror = () => {
    if (current !== generation || stream !== connection || !running) return;
    connection.close();
    onEvent({ type: 'error', message: 'Connection to the renderer was lost. Search again to reconnect; cached captures are kept.' });
  };
}
function stopScreenshots() {
  screenshotStream?.close(); screenshotStream = null;
  clearTimeout(screenshotTimer); screenshotPath = null;
}
function warmScreenshots(path, current, attempts = 0) {
  if (current !== generation || attempts >= 3) return;
  const connection = new EventSource(path);
  screenshotStream = connection;
  connection.onmessage = message => {
    if (current !== generation || screenshotStream !== connection) return;
    let event;
    try { event = JSON.parse(message.data); } catch { connection.close(); return; }
    if (event.type === 'capture' && event.capture.image && !event.capture.error) {
      const index = captures.findIndex(c => captureKey(c) === captureKey(event.capture));
      if (index >= 0 && !captures[index].image && !entries.get(captureKey(captures[index]))?.querySelector('.is-interacting')) {
        // Keep HTML comparisons homogeneous. A screenshot is a poster, not a
        // reason to replace comparison text or lose its pending/error status.
        captures[index] = captures[index].error
          ? { ...event.capture, preview: 'image', previewUrl: captures[index].previewUrl || event.capture.archiveUrl, textSource: 'rendered', textPending: false }
          : { ...captures[index], image: event.capture.image, preview: 'image', timestamp: event.capture.timestamp, requestedTimestamp: event.capture.requestedTimestamp || event.capture.timestamp, archiveUrl: event.capture.archiveUrl };
        render();
      }
    }
    if (event.type === 'continue') {
      connection.close();
      screenshotTimer = setTimeout(() => warmScreenshots(path, current, attempts + 1), Math.max(20, Number(event.retryAfter) || 90) * 1000);
    }
    // Quota failures only stop optional warming, never the usable HTML timeline.
    if (event.type === 'done' || event.type === 'error') connection.close();
  };
  connection.onerror = () => connection.close();
}
function begin(mode, source) {
  flushPreviewStats();
  analytics.begin(mode, source);
  clearTimeout(resumeTimer);
  stopScreenshots();
  lookupAbort?.abort(); lookupAbort = null; indexFailed = false;
  resetPreviews();
  navigation.reset();
  generation++; captures = []; requested = []; indexed = false; entries.clear(); $('timeline').replaceChildren(); total = 0; sampled = 0; capped = false; running = true; stream?.close();
  indexLabel = null;
  $('search-button').disabled = true; $('results').hidden = false; $('explainer').hidden = true; $('error').hidden = true; $('progress').hidden = false; $('progress-fill').style.width = '0%'; $('status').textContent = 'Finding archived captures…';
  delete $('error').dataset.partialResults;
  $('from').placeholder = 'Earliest'; $('to').placeholder = 'Latest';
  samplingNote();
  $('site-title').textContent = $('url').value; render();
  return generation;
}
function updateSearchUrl() {
  const value = $('url').value.trim();
  try {
    const site = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (site.username || site.password) return;
  } catch { return; }
  const target = new URL(location.href);
  for (const key of ['url', 'from', 'to', 'count']) target.searchParams.delete(key);
  target.searchParams.set('url', value);
  for (const key of ['from', 'to']) if ($(key).value) target.searchParams.set(key, $(key).value);
  if ($('count').value !== '8') target.searchParams.set('count', $('count').value);
  if (target.href !== location.href) history.pushState(null, '', target);
}
async function search(recordHistory = true) {
  if (recordHistory) updateSearchUrl();
  let preset;
  try {
    const raw = $('url').value.trim();
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, '');
    if (exampleForSite(raw)) preset = host;
  } catch {}
  if (preset && !$('from').value && !$('to').value && $('count').value === '8') { await loadDemo(preset, recordHistory ? 'user' : 'automatic'); return; }
  const current = begin('custom', recordHistory ? 'user' : 'automatic');
  const abort = new AbortController(); lookupAbort = abort;
  try {
    const data = await requestSearchJob({ url: $('url').value, from: $('from').value, to: $('to').value, count: $('count').value, previewMode: 'html' }, { signal: abort.signal });
    if (current !== generation) return;
    $('site-title').textContent = data.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    screenshotPath = data.screenshotCache ? `/api/jobs/${data.id}/screenshots` : null;
    connectStream(`/api/jobs/${data.id}/events`, current);
   } catch (error) { if (current === generation && !abort.signal.aborted) onEvent({ type: 'error', message: error.message }); }
  finally { if (lookupAbort === abort) lookupAbort = null; }
}
$('search-form').onsubmit = event => { event.preventDefault(); if (!running) void search(); };
async function loadDemo(site, source = 'user') {
  $('url').value = site;
  const current = begin('demo', source);
  try {
    const example = exampleForSite(site);
    if (!example) throw new Error('Unknown cached example.');
    const response = await fetch(`/api/demos/${example.id}`);
    const data = await response.json(); if (current !== generation) return;
    if (!response.ok || !data.captures?.length) throw new Error(data.error || 'Cached previews are not available yet. Change the dates or sample size in Settings to request a fresh history.');
    indexed = true; total = data.total; sampled = data.sampled; capped = data.capped; captures = data.captures;
    indexLabel = data.curated ? 'Curated example' : 'Cached example';
    const notes = [];
    if (data.captures.some(c => c.sourceType === 'live')) notes.push('The Current card is a separately labelled live-site capture on the date shown, not an Internet Archive replay.');
    $('site-title').textContent = data.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const first = data.firstTimestamp || captures[0].timestamp, last = data.lastTimestamp || captures.at(-1).timestamp;
    $('from').placeholder = first.slice(0, 4); $('to').placeholder = last.slice(0, 4);
    const unavailable = Array.isArray(data.unavailable) ? data.unavailable.length : Number(data.unavailable || 0);
    if (unavailable && data.indexNote && data.curated) notes.push(`${unavailable} other replay attempts were unavailable during curation; the successful captures are shown.`);
    else if (unavailable) { $('error').textContent = `Partial cached history: ${unavailable} preview attempts were unavailable. Showing the successful captures.`; $('error').hidden = false; }
    samplingNote(notes.join(' '));
    finish();
  } catch (error) { if (current === generation) onEvent({ type: 'error', message: error.message }); }
}
for (const button of document.querySelectorAll('[data-site]')) button.onclick = () => { $('from').value = ''; $('to').value = ''; $('count').value = '8'; $('url').value = button.dataset.site; updateSearchUrl(); void loadDemo(button.dataset.site); };
$('changes-view').onclick = () => { changesOnly = true; toggle(); };
$('all-view').onclick = () => { changesOnly = false; toggle(); };
function toggle() { $('changes-view').classList.toggle('active', changesOnly); $('all-view').classList.toggle('active', !changesOnly); $('changes-view').setAttribute('aria-pressed', String(changesOnly)); $('all-view').setAttribute('aria-pressed', String(!changesOnly)); render(); }
let sensitivityFrame;
$('sensitivity').oninput = () => { $('sensitivity-value').textContent = $('sensitivity').value + '%'; if (!sensitivityFrame) sensitivityFrame = requestAnimationFrame(() => { sensitivityFrame = null; render(); }); };
$('close-dialog').onclick = () => $('compare-dialog').close();
$('compare-dialog').onclick = event => { if (event.target === $('compare-dialog')) $('compare-dialog').close(); };
const currentYear = new Date().getFullYear();
for (const id of ['from', 'to']) $(id).max = currentYear;
window.addEventListener('pagehide', () => { clearTimeout(resumeTimer); lookupAbort?.abort(); stream?.close(); stopScreenshots(); resetPreviews(); });
window.addEventListener('pageshow', event => { if (event.persisted) restoreSearch(); });
function restoreSearch() {
  const params = new URLSearchParams(location.search);
  $('url').value = params.get('url') || 'stripe.com';
  for (const id of ['from', 'to']) $(id).value = params.get(id) || '';
  $('count').value = ['8', '16', '24'].includes(params.get('count')) ? params.get('count') : '8';
  void search(false);
}
window.addEventListener('popstate', restoreSearch);
restoreSearch();

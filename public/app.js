import { groupCaptures, similarity, comparableText } from '/group.js';
import { livePreview, refreshPreviews, resetPreviews } from '/previews.js';
import { exampleForSite } from '/examples.js';

const $ = id => document.getElementById(id);
let captures = [], changesOnly = true, total = 0, sampled = 0, capped = false, running = false, stream;
let requested = [], indexed = false, generation = 0;
let resumeTimer;
let indexLabel;
const entries = new Map();
const captureKey = capture => `${capture.requestedTimestamp || capture.timestamp}:${capture.original}`;
const captureOrder = capture => capture.requestedTimestamp || capture.timestamp;
const date = stamp => new Date(`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
function render() {
  const groups = groupCaptures(captures, Number($('sensitivity').value) / 100);
  const pending = running ? (requested.length ? requested : Array.from({ length: Number($('count').value) }, (_, i) => ({ slot: i, original: $('url').value }))).filter(c => !captures.some(result => captureKey(result) === captureKey(c))) : [];
  // Do not collapse slots while captures arrive. Errors always remain visible, even in grouped view.
  const visible = running ? [...captures, ...pending.map(c => ({ ...c, pending: true }))] : changesOnly ? [...groups, ...captures.filter(c => c.error)] : captures.map(c => ({ ...c, count: 1 }));
  visible.sort((a, b) => (captureOrder(a) || '').localeCompare(captureOrder(b) || '') || (a.slot || 0) - (b.slot || 0));
  const failed = captures.filter(c => c.error).length;
  const knownGroups = groups.filter(c => comparableText(c, c)).length;
  const unCompared = captures.filter(c => !c.error && !comparableText(c, c)).length;
  $('stats').textContent = indexed ? `${indexLabel || (capped ? '1,200+ indexed' : `${total.toLocaleString()} indexed`)} · ${captures.length}/${sampled} sampled · ${knownGroups} text versions${unCompared ? ` · ${unCompared} not compared` : ''}${running ? ` · ${Math.max(0, sampled - captures.length)} pending` : ''}${failed ? ` · ${failed} unavailable` : ''}` : 'Finding archived captures…';
  $('sensitivity-value').textContent = $('sensitivity').value + '%';
  $('empty-state').hidden = running || visible.length > 0;
  let previous, position = 0;
  const visibleKeys = new Set();
  for (const capture of visible) {
    const currentSite = capture.sourceType === 'live';
    const key = capture.timestamp ? captureKey(capture) : `finding-${capture.slot}`;
    visibleKeys.add(key);
    let entry = entries.get(key);
    if (!entry) {
      entry = el('article', 'timeline-entry');
      entry.dataset.capture = key;
      entries.set(key, entry);
    }
    const meta = el('div', 'entry-meta');
    meta.append(el('div', 'entry-date', currentSite ? 'Current' : capture.timestamp ? capture.timestamp.slice(0, 4) : 'Finding capture'), el('div', 'entry-month', capture.timestamp ? date(capture.timestamp) : `Sample ${capture.slot + 1}`));
    const difference = comparableText(previous, capture) && !capture.error && !capture.pending ? Math.round((1 - similarity(previous.text, capture.text)) * 100) : null;
    const noDifference = !previous ? 'FIRST SEEN' : (previous.textSource || 'rendered') !== (capture.textSource || 'rendered') ? 'DIFFERENT TEXT SOURCES' : 'NO PREVIOUS TEXT';
    meta.append(el('div', 'entry-badge', currentSite ? 'LIVE SITE CAPTURE · NOT AN ARCHIVE REPLAY' : capture.pending ? 'PENDING' : capture.error ? 'UNAVAILABLE' : capture.textPending ? 'READING HTML' : capture.comparisonUnavailable || capture.textTruncated ? 'TEXT UNAVAILABLE' : difference === null ? noDifference : `${difference}% TEXT DIFFERENCE`));
    if (capture.count > 1) meta.append(el('div', 'entry-count', `${capture.count} similar sampled captures\nthrough ${date(capture.lastTimestamp)}`));
    // Only rebuild a preview when its own data changes, never for another SSE result.
    const signature = JSON.stringify([capture.pending, capture.image, capture.previewUrl, capture.error, capture.original, capture.sourceType]);
    let card = entry.querySelector('.entry-card');
    if (!card || entry.dataset.signature !== signature || card.querySelector('[data-preview-disposed]')) {
      card = el('div', 'entry-card');
      const chrome = el('div', 'browser-chrome');
      chrome.append(el('i'), el('i'), el('i'), el('span', 'browser-url', capture.original.replace(/^https?:\/\//, '')));
      card.append(chrome);
      if (capture.pending) {
        entry.setAttribute('aria-busy', 'true');
        const skeleton = el('div', 'entry-pending');
        const lines = el('div', 'skeleton-lines'); lines.setAttribute('aria-hidden', 'true'); lines.append(el('i'), el('i'), el('i'));
        skeleton.append(lines, el('span', '', indexed ? 'Waiting for archived preview…' : 'Looking up archived dates…'));
        card.append(skeleton, el('div', 'entry-placeholder-bottom', 'Preview pending'));
      } else if (capture.error) {
        entry.removeAttribute('aria-busy');
        card.append(el('div', 'entry-error', capture.error), el('div', 'entry-placeholder-bottom', 'This capture could not be loaded. Other results are kept.'));
      }
      else {
        entry.removeAttribute('aria-busy');
        if (capture.image) {
          const link = el('a', 'preview-link'); link.href = capture.archiveUrl; link.target = '_blank'; link.rel = 'noopener';
          const image = el('img'); image.src = capture.image; image.alt = `${capture.title || capture.original}, ${currentSite ? 'live site captured' : 'archived'} ${date(capture.timestamp)}`; image.loading = 'lazy'; link.append(image); card.append(link);
        } else card.append(livePreview(capture, `${capture.title || capture.original}, archived ${date(capture.timestamp)}`));
        const bottom = el('div', 'card-bottom'); bottom.append(el('span', 'entry-title', capture.title || 'Archived page'));
        const actions = el('div', 'card-actions');
        const button = el('button', 'compare-button', 'Compare text'); button.type = 'button'; actions.append(button);
        const open = el('a', '', currentSite ? 'Open current site ↗' : 'Open archive ↗'); open.href = capture.archiveUrl; open.target = '_blank'; open.rel = 'noopener'; actions.append(open); bottom.append(actions); card.append(bottom);
      }
      entry.replaceChildren(meta, card);
      entry.dataset.signature = signature;
    } else entry.querySelector('.entry-meta').replaceWith(meta);
    const title = card.querySelector('.entry-title'); if (title) title.textContent = capture.title || 'Archived page';
    for (const link of card.querySelectorAll('.card-actions a, .preview-link')) link.href = capture.archiveUrl;
    let textStatus = card.querySelector('.text-status');
    if (capture.comparisonUnavailable && !capture.textPending && !capture.error) {
      if (!textStatus) { textStatus = el('p', 'text-status'); card.append(textStatus); }
      textStatus.textContent = capture.textError || (capture.textTruncated ? 'HTML text is too long for a complete comparison.' : 'Little or no text in the archived HTML. JavaScript may supply the visible content.');
    } else textStatus?.remove();
    const button = card.querySelector('.compare-button');
    if (button) {
      const before = previous;
      button.hidden = !comparableText(before, capture);
      button.onclick = () => compare(before, capture);
    }
    if (!capture.error && !capture.pending) previous = capture;
    // insertBefore only when necessary; existing image nodes stay connected.
    const current = $('timeline').children[position];
    if (current !== entry) $('timeline').insertBefore(entry, current || null);
    position++;
  }
  for (const entry of [...$('timeline').children]) if (!visibleKeys.has(entry.dataset.capture)) entry.remove();
  refreshPreviews();
}
function compare(before, after) {
  document.querySelector('.compare-note').textContent = before.textSource === 'html' ? 'Compares text extracted from archived HTML, not rendered pixels. JavaScript-only text can be missing; responsive duplicates are removed.' : 'Text lines are compared, not image pixels. Reflowed text can appear as an edit.';
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
  // A truncated stream must not quietly erase unfinished samples.
  for (const capture of requested) if (!captures.some(result => captureKey(result) === captureKey(capture))) captures.push({ ...capture, error: 'No preview returned for this capture. Try again to load it.' });
  for (const capture of captures) if (capture.textPending) { capture.textPending = false; capture.comparisonUnavailable = !capture.text?.trim(); capture.textError = 'HTML lookup did not finish. Preview remains available.'; }
  running = false; $('search-button').disabled = false; $('progress').hidden = true; render();
  const failed = captures.filter(c => c.error).length;
  if (failed && $('error').hidden) { $('error').textContent = `Partial results: ${failed} of ${sampled} sampled captures could not be loaded. Available previews are shown below.`; $('error').hidden = false; }
}
function onEvent(event) {
  if (event.type === 'status') $('status').textContent = event.message;
  if (event.type === 'index') {
    indexed = true; total = event.total; sampled = event.sampled; capped = event.capped;
    requested = event.captures || [];
    if (event.firstTimestamp) $('from').placeholder = event.firstTimestamp.slice(0, 4);
    if (event.lastTimestamp) $('to').placeholder = event.lastTimestamp.slice(0, 4);
    $('status').textContent = `Loading ${sampled} archived previews…`;
    $('sampling-note').textContent = `A sampled history, not every change.${event.monthly ? ' Dense history: samples are drawn from one candidate per month across the date range.' : ''}${event.textSource === 'html' ? ' New previews load directly from the Internet Archive. Grouping compares archived HTML text, which can miss JavaScript-only content.' : ''} Dates show when a version was archived, not when it launched.`; render();
  }
  if (event.type === 'capture') {
    const index = captures.findIndex(c => captureKey(c) === captureKey(event.capture));
    if (index < 0) captures.push(event.capture); else captures[index] = event.capture;
    captures.sort((a, b) => captureOrder(a).localeCompare(captureOrder(b)) || captureKey(a).localeCompare(captureKey(b)));
    $('progress-fill').style.width = `${sampled ? Math.min(100, captures.length / sampled * 100) : 0}%`;
    $('status').textContent = `${captures.length} of ${sampled} previews returned. ${Math.max(0, sampled - captures.length)} pending.`;
    render();
  }
  if (event.type === 'done') { stream?.close(); finish(); }
  if (event.type === 'error') { stream?.close(); $('error').textContent = event.message + (Number.isFinite(event.retryAfter) && event.retryAfter > 0 ? ` Try again in ${Math.ceil(event.retryAfter / 60)} minutes.` : ''); $('error').hidden = false; finish(); }
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
function begin() {
  clearTimeout(resumeTimer);
  resetPreviews();
  generation++; captures = []; requested = []; indexed = false; entries.clear(); $('timeline').replaceChildren(); total = 0; sampled = 0; capped = false; running = true; stream?.close();
  indexLabel = null;
  $('search-button').disabled = true; $('results').hidden = false; $('explainer').hidden = true; $('error').hidden = true; $('progress').hidden = false; $('progress-fill').style.width = '0%'; $('status').textContent = 'Finding archived captures…';
  $('from').placeholder = 'Earliest'; $('to').placeholder = 'Latest';
  $('sampling-note').textContent = 'A sampled history, not every change. Dates show when a version was archived, not when it launched.';
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
  if (preset && !$('from').value && !$('to').value && $('count').value === '8') { await loadDemo(preset); return; }
  const current = begin();
  try {
    const response = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: $('url').value, from: $('from').value, to: $('to').value, count: $('count').value, previewMode: 'html' }) });
    const data = await response.json(); if (current !== generation) return; if (!response.ok) throw new Error(data.error);
    $('site-title').textContent = data.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    connectStream(`/api/jobs/${data.id}/events`, current);
  } catch (error) { if (current === generation) onEvent({ type: 'error', message: error.message }); }
}
$('search-form').onsubmit = event => { event.preventDefault(); if (!running) void search(); };
async function loadDemo(site) {
  $('url').value = site;
  const current = begin();
  try {
    const example = exampleForSite(site);
    if (!example) throw new Error('Unknown cached example.');
    const response = await fetch(`/api/demos/${example.id}`);
    const data = await response.json(); if (current !== generation) return;
    if (!response.ok || !data.captures?.length) throw new Error(data.error || 'Cached previews are not available yet. Change the dates or sample size in Settings to request a fresh history.');
    indexed = true; total = data.total; sampled = data.sampled; capped = data.capped; captures = data.captures;
    indexLabel = data.curated ? 'Curated example' : null;
    $('sampling-note').textContent = 'Cached example. A selection of archived previews, not every capture or change. Dates show when a page was archived, not when it launched.';
    if(data.captures.some(c=>c.sourceType==='live')) $('sampling-note').textContent += ' The Current card is a separately labelled live-site capture on the date shown, not an Internet Archive replay.';
    $('site-title').textContent = data.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const first = data.firstTimestamp || captures[0].timestamp, last = data.lastTimestamp || captures.at(-1).timestamp;
    $('from').placeholder = first.slice(0, 4); $('to').placeholder = last.slice(0, 4);
    const unavailable = Array.isArray(data.unavailable) ? data.unavailable.length : Number(data.unavailable || 0);
    if (unavailable && data.indexNote && data.curated) $('sampling-note').textContent += ` ${unavailable} other replay attempts were unavailable during curation; the successful captures are shown.`;
    else if (unavailable) { $('error').textContent = `Partial cached history: ${unavailable} preview attempts were unavailable. Showing the successful captures.`; $('error').hidden = false; }
    finish();
  } catch (error) { if (current === generation) onEvent({ type: 'error', message: error.message }); }
}
for (const button of document.querySelectorAll('[data-site]')) button.onclick = () => { $('from').value = ''; $('to').value = ''; $('count').value = '8'; $('url').value = button.dataset.site; updateSearchUrl(); void loadDemo(button.dataset.site); };
$('changes-view').onclick = () => { changesOnly = true; toggle(); };
$('all-view').onclick = () => { changesOnly = false; toggle(); };
function toggle() { $('changes-view').classList.toggle('active', changesOnly); $('all-view').classList.toggle('active', !changesOnly); $('changes-view').setAttribute('aria-pressed', String(changesOnly)); $('all-view').setAttribute('aria-pressed', String(!changesOnly)); render(); }
$('sensitivity').oninput = render;
$('close-dialog').onclick = () => $('compare-dialog').close();
$('compare-dialog').onclick = event => { if (event.target === $('compare-dialog')) $('compare-dialog').close(); };
const currentYear = new Date().getFullYear();
for (const id of ['from', 'to']) $(id).max = currentYear;
window.addEventListener('pagehide', () => { clearTimeout(resumeTimer); stream?.close(); resetPreviews(); });
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

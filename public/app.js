import { groupCaptures, similarity } from '/group.js';

const $ = id => document.getElementById(id);
let captures = [], changesOnly = true, total = 0, sampled = 0, capped = false, running = false, stream;
const entries = new Map();
const captureKey = capture => `${capture.requestedTimestamp || capture.timestamp}:${capture.original}`;
const captureOrder = capture => capture.requestedTimestamp || capture.timestamp;
const date = stamp => new Date(`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
function render() {
  const groups = groupCaptures(captures, Number($('sensitivity').value) / 100);
  const visible = changesOnly ? groups : captures.map(c => ({ ...c, count: 1 }));
  const failed = captures.filter(c => c.error).length;
  $('stats').textContent = `${capped ? '1,200+ indexed' : `${total.toLocaleString()} indexed`} · ${captures.length}/${sampled} sampled · ${groups.length} text versions${failed ? ` · ${failed} unavailable` : ''}`;
  $('sensitivity-value').textContent = $('sensitivity').value + '%';
  $('empty-state').hidden = running || visible.length > 0;
  let previous, position = 0;
  const visibleKeys = new Set();
  for (const capture of visible) {
    const key = captureKey(capture);
    visibleKeys.add(key);
    let entry = entries.get(key);
    if (!entry) {
      entry = el('article', 'timeline-entry');
      entry.dataset.capture = key;
      entries.set(key, entry);
    }
    const meta = el('div', 'entry-meta');
    meta.append(el('div', 'entry-date', capture.timestamp.slice(0, 4)), el('div', 'entry-month', date(capture.timestamp)));
    const difference = previous && !capture.error ? Math.round((1 - similarity(previous.text, capture.text)) * 100) : null;
    meta.append(el('div', 'entry-badge', capture.error ? 'UNAVAILABLE' : difference === null ? 'FIRST SEEN' : `${difference}% TEXT DIFFERENCE`));
    if (capture.count > 1) meta.append(el('div', 'entry-count', `${capture.count} similar sampled captures\nthrough ${date(capture.lastTimestamp)}`));
    // Only rebuild a preview when its own data changes, never for another SSE result.
    const signature = JSON.stringify([capture.image, capture.error, capture.title, capture.archiveUrl, capture.original, capture.timestamp]);
    let card = entry.querySelector('.entry-card');
    if (!card || entry.dataset.signature !== signature) {
      card = el('div', 'entry-card');
      const chrome = el('div', 'browser-chrome');
      chrome.append(el('i'), el('i'), el('i'), el('span', 'browser-url', capture.original.replace(/^https?:\/\//, '')));
      card.append(chrome);
      if (capture.error) card.append(el('div', 'entry-error', capture.error));
      else {
        const link = el('a', 'preview-link'); link.href = capture.archiveUrl; link.target = '_blank'; link.rel = 'noopener';
        const image = el('img'); image.src = capture.image; image.alt = `${capture.title || capture.original}, archived ${date(capture.timestamp)}`; image.loading = 'lazy'; link.append(image); card.append(link);
        const bottom = el('div', 'card-bottom'); bottom.append(el('span', 'entry-title', capture.title || 'Archived page'));
        const actions = el('div', 'card-actions');
        const button = el('button', 'compare-button', 'Compare text'); button.type = 'button'; actions.append(button);
        const open = el('a', '', 'Open archive ↗'); open.href = capture.archiveUrl; open.target = '_blank'; open.rel = 'noopener'; actions.append(open); bottom.append(actions); card.append(bottom);
      }
      entry.replaceChildren(meta, card);
      entry.dataset.signature = signature;
    } else entry.querySelector('.entry-meta').replaceWith(meta);
    const button = card.querySelector('.compare-button');
    if (button) {
      const before = previous;
      button.hidden = !before;
      button.onclick = () => compare(before, capture);
    }
    if (!capture.error) previous = capture;
    // insertBefore only when necessary; existing image nodes stay connected.
    const current = $('timeline').children[position];
    if (current !== entry) $('timeline').insertBefore(entry, current || null);
    position++;
  }
  for (const entry of [...$('timeline').children]) if (!visibleKeys.has(entry.dataset.capture)) entry.remove();
}
function compare(before, after) {
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
function finish() { running = false; $('search-button').disabled = false; $('progress').hidden = true; render(); }
function onEvent(event) {
  if (event.type === 'status') $('status').textContent = event.message;
  if (event.type === 'index') { total = event.total; sampled = event.sampled; capped = event.capped; $('sampling-note').textContent = `A sampled history, not every change.${event.monthly ? ' Dense history: samples are drawn from one candidate per month across the date range.' : ''} Dates show when a version was archived, not when it launched.`; render(); }
  if (event.type === 'capture') {
    const index = captures.findIndex(c => captureKey(c) === captureKey(event.capture));
    if (index < 0) captures.push(event.capture); else captures[index] = event.capture;
    captures.sort((a, b) => captureOrder(a).localeCompare(captureOrder(b)) || captureKey(a).localeCompare(captureKey(b)));
    $('progress-fill').style.width = `${sampled ? Math.min(100, event.completed / sampled * 100) : 0}%`;
    render();
  }
  if (event.type === 'done') { stream?.close(); finish(); }
  if (event.type === 'error') { stream?.close(); $('error').textContent = event.message; $('error').hidden = false; finish(); }
}
$('search-form').onsubmit = async event => {
  event.preventDefault(); if (running) return;
  captures = []; entries.clear(); $('timeline').replaceChildren(); total = 0; sampled = 0; capped = false; running = true; stream?.close();
  $('search-button').disabled = true; $('results').hidden = false; $('explainer').hidden = true; $('error').hidden = true; $('progress').hidden = false; $('progress-fill').style.width = '0%'; $('status').textContent = 'Finding archived captures…';
  $('site-title').textContent = $('url').value; render();
  try {
    const response = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: $('url').value, from: $('from').value, to: $('to').value, count: $('count').value }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    $('site-title').textContent = data.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    stream = new EventSource(`/api/jobs/${data.id}/events`);
    stream.onmessage = event => onEvent(JSON.parse(event.data));
    stream.onerror = () => { if (running) { stream.close(); onEvent({ type: 'error', message: 'Connection to the renderer was lost. Search again to reconnect; cached captures are kept.' }); } };
  } catch (error) { onEvent({ type: 'error', message: error.message }); }
};
for (const button of document.querySelectorAll('[data-site]')) button.onclick = () => { $('url').value = button.dataset.site; $('search-form').requestSubmit(); };
$('changes-view').onclick = () => { changesOnly = true; toggle(); };
$('all-view').onclick = () => { changesOnly = false; toggle(); };
function toggle() { $('changes-view').classList.toggle('active', changesOnly); $('all-view').classList.toggle('active', !changesOnly); $('changes-view').setAttribute('aria-pressed', String(changesOnly)); $('all-view').setAttribute('aria-pressed', String(!changesOnly)); render(); }
$('sensitivity').oninput = render;
$('close-dialog').onclick = () => $('compare-dialog').close();
$('compare-dialog').onclick = event => { if (event.target === $('compare-dialog')) $('compare-dialog').close(); };
const currentYear = new Date().getFullYear();
for (const id of ['from', 'to']) $(id).max = currentYear;
$('to').value = currentYear;
const params = new URLSearchParams(location.search);
if (params.has('url')) {
  $('url').value = params.get('url');
  for (const id of ['from', 'to', 'count']) if (params.has(id)) $(id).value = params.get(id);
  $('search-form').requestSubmit();
}

// Replays remain cross-origin. Never proxy their scripts onto our origin.
const previews = new Map();
const residentLimit = navigator.connection?.saveData || navigator.deviceMemory <= 4 ? 4 : navigator.deviceMemory ? 8 : 6;
let scheduled = false, lastY = window.scrollY, direction = 1, clock = 0, interacting = null;
let cooldownUntil = 0, archiveBackoff = 0;
const refusedLoadMs = () => window.refusedLoadMs ?? 700;
const safeReplay = input => {
  try {
    const url = new URL(input);
    return url.origin === 'https://web.archive.org' && !url.username && !url.password && /^\/web\/\d{14}(?:if_)?\/https?:\/\//.test(url.pathname)
      ? url.href.replace(/(\/web\/\d{14})(?:if_)?\//, '$1if_/') : null;
  } catch { return null; }
};
function schedule() {
  if (scheduled || !previews.size) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; refreshPreviews(); });
}
window.addEventListener('scroll', schedule, { passive: true });
window.addEventListener('resize', schedule, { passive: true });
function status(state, text = '') {
  state.status.textContent = text;
  state.status.hidden = !text;
}
function interaction(state, enabled) {
  if (enabled && interacting && interacting !== state) interaction(interacting, false);
  interacting = enabled ? state : interacting === state ? null : interacting;
  state.interacting = enabled;
  state.wrapper.classList.toggle('is-interacting', enabled);
  state.button.textContent = enabled ? 'Done' : 'Interact';
  state.button.setAttribute('aria-pressed', String(enabled));
  state.shield.hidden = enabled;
  if (state.frame) {
    state.frame.tabIndex = enabled ? 0 : -1;
    state.frame.setAttribute('aria-hidden', String(!enabled));
    if (!enabled && document.activeElement === state.frame) state.button.focus({ preventScroll: true });
  }
  if (enabled) { state.manual = false; state.used = ++clock; state.priority = !state.frame; refreshPreviews(); }
}
function release(state) {
  state.priority = false;
  state.generation++;
  clearTimeout(state.timer);
  if (state.frame) {
    state.frame.onload = state.frame.onerror = null;
    state.frame.remove(); state.frame = null;
  }
  state.phase = 'idle'; state.wrapper.dataset.previewState = 'idle';
  state.wrapper.removeAttribute('aria-busy');
  state.retry.hidden = true;
  if (state.poster) state.poster.hidden = false;
  status(state);
}
function destroy(state) {
  interaction(state, false); release(state);
  state.wrapper.dataset.previewDisposed = 'true';
  state.resize?.disconnect();
  state.button.removeEventListener('click', state.toggle);
  state.shield.removeEventListener('click', state.enter);
  state.retry.removeEventListener('click', state.restart);
  previews.delete(state.wrapper);
}
function activate(state) {
  state.phase = 'loading'; state.priority = false; state.used = ++clock;
  state.retry.hidden = true;
  state.wrapper.dataset.previewState = 'loading';
  state.wrapper.setAttribute('aria-busy', 'true');
  const generation = ++state.generation;
  const frame = document.createElement('iframe'); state.frame = frame;
  frame.className = 'live-frame'; frame.title = state.label;
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.setAttribute('allow', "autoplay 'none'; camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'");
  frame.referrerPolicy = 'no-referrer'; frame.loading = 'eager';
  frame.tabIndex = state.interacting ? 0 : -1;
  frame.setAttribute('aria-hidden', String(!state.interacting));
  frame.style.transform = `scale(${state.stage.clientWidth / 1280})`;
  const finish = failed => {
    if (generation !== state.generation || state.phase !== 'loading') return;
    clearTimeout(state.timer);
    state.priority = false;
    if (failed) { interaction(state, false); release(state); }
    state.phase = failed ? 'error' : 'ready'; state.wrapper.dataset.previewState = state.phase;
    state.wrapper.removeAttribute('aria-busy');
    state.retry.hidden = !failed;
    if (!failed && state.poster) state.poster.hidden = true;
    status(state, failed ? 'Replay could not load here. Retry or open the archive.' : ''); schedule();
  };
  const started = performance.now();
  frame.onload = () => {
    if (generation !== state.generation || state.phase !== 'loading') return;
    // A refused archive request shows Chrome's sad-page icon and still fires load,
    // within milliseconds. Real replays need a redirect, a document and subresources.
    if (performance.now() - started >= refusedLoadMs()) { archiveBackoff = 0; return finish(false); }
    state.refusals++;
    archiveBackoff = Math.min(archiveBackoff + 1, 4);
    cooldownUntil = Date.now() + 2000 * 2 ** (archiveBackoff - 1);
    if (state.refusals >= 3) return finish(true);
    interaction(state, false); release(state);
    state.retryAt = cooldownUntil + 1500 * state.refusals;
    status(state, 'The archive is busy. Retrying shortly…');
    setTimeout(schedule, state.retryAt - Date.now() + 50);
  };
  frame.onerror = () => finish(true);
  status(state, 'Loading from the Internet Archive…');
  const checkDeadline = () => {
    if (generation !== state.generation || state.phase !== 'loading') return;
    // Archives can paint and accept input long before slow subresources finish.
    // Never discard a usable on-screen document merely for lacking a load event.
    const rect = state.wrapper.getBoundingClientRect();
    state.retry.hidden = false;
    if (state.interacting || (rect.bottom > 0 && rect.top < window.innerHeight)) {
      status(state, 'The archive is still loading. You can wait, retry, or open the archive.');
      state.timer = setTimeout(checkDeadline, 10000);
      return;
    }
    interaction(state, false); release(state); state.phase = 'error'; state.wrapper.dataset.previewState = 'error';
    state.retry.hidden = false;
    status(state, 'The archive took too long. Retry or open the archive.'); schedule();
  };
  state.timer = setTimeout(checkDeadline, 20000);
  frame.src = state.url; state.stage.prepend(frame);
}
export function refreshPreviews() {
  for (const state of [...previews.values()]) if (!state.wrapper.isConnected) destroy(state);
  if (window.scrollY !== lastY) direction = window.scrollY > lastY ? 1 : -1;
  lastY = window.scrollY;
  const height = window.innerHeight;
  for (const state of previews.values()) {
    const r = state.wrapper.getBoundingClientRect();
    state.distance = Math.max(0, -r.bottom, r.top - height);
    const wasVisible = state.visible;
    state.visible = r.bottom > 0 && r.top < height;
    // An offscreen preload timeout must not become a permanent blank card.
    // Retry once on entering the viewport, never in a scroll/resize retry loop.
    if (state.phase === 'error' && state.visible && !wasVisible && state.automaticRetries < 1) {
      state.automaticRetries++;
      state.priority = true;
    }
    state.near = r.bottom > -(direction < 0 ? 2 : .5) * height && r.top < height * (direction > 0 ? 3 : 1.5);
    if (state.visible) state.used = ++clock;
  }
  const candidates = [...previews.values()].filter(s => !s.manual && (s.near || s.priority || s.interacting))
    .sort((a, b) => Number(b.priority || b.interacting) - Number(a.priority || a.interacting) || Number(b.visible) - Number(a.visible) || a.distance - b.distance);
  const now = Date.now();
  if (now < cooldownUntil) { setTimeout(schedule, cooldownUntil - now + 50); return; }
  for (const state of candidates) {
    if (state.frame || (state.phase === 'error' && !state.priority) || state.retryAt > now) continue;
    const loading = [...previews.values()].filter(s => s.phase === 'loading');
    if (loading.length >= 2) {
      // Scrolling onto a card, like a deliberate jump, must not wait behind
      // two stalled offscreen preloads. Never cancel an on-screen document.
      const stale = (state.priority || state.visible) && loading.filter(s => !s.visible && !s.interacting)
        .sort((a, b) => b.distance - a.distance || a.used - b.used)[0];
      if (!stale) break;
      release(stale);
    }
    const residents = [...previews.values()].filter(s => s.frame);
    if (residents.length >= residentLimit) {
      const victim = residents.filter(s => !s.interacting && !s.visible && s.phase !== 'loading' && !s.priority)
        .sort((a, b) => Number(a.near) - Number(b.near) || a.used - b.used || b.distance - a.distance)[0];
      if (!victim || (!state.priority && !state.visible && victim.near)) continue;
      release(victim);
    }
    activate(state);
  }
}
export function prioritizePreview(entryOrWrapper) {
  const wrapper = previews.has(entryOrWrapper) ? entryOrWrapper : entryOrWrapper?.querySelector('.live-preview');
  const state = previews.get(wrapper);
  if (!state || state.manual) return;
  state.used = ++clock;
  state.priority = !state.frame;
  refreshPreviews();
}
export function resetPreviews() {
  for (const state of [...previews.values()]) destroy(state);
  lastY = window.scrollY; direction = 1;
}
export function livePreview(capture, label, { poster, manual = false } = {}) {
  const wrapper = document.createElement('div'); wrapper.className = 'live-preview';
  wrapper.dataset.previewState = 'idle';
  const stage = document.createElement('div'); stage.className = 'live-stage';
  const message = document.createElement('p'); message.className = 'live-status'; message.hidden = true;
  message.setAttribute('role', 'status');
  const url = safeReplay(capture.previewUrl || capture.archiveUrl);
  if (!url) { message.hidden = false; message.textContent = 'Invalid archive preview URL. Use Open archive.'; wrapper.append(message); return wrapper; }
  const button = document.createElement('button'); button.type = 'button'; button.className = 'preview-interact-button'; button.textContent = 'Interact'; button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', `Interact with ${label}`);
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'preview-retry-button'; retry.textContent = 'Retry preview'; retry.hidden = true; retry.setAttribute('aria-label', `Retry preview of ${label}`);
  const shield = document.createElement('button'); shield.type = 'button'; shield.className = 'preview-interaction-shield'; shield.tabIndex = -1; shield.setAttribute('aria-label', `Interact with ${label}`);
  const state = { wrapper, stage, status: message, button, retry, shield, label, url, manual, generation: 0, phase: 'idle', used: 0, automaticRetries: 0, refusals: 0, retryAt: 0 };
  if (poster) {
    const image = document.createElement('img'); image.className = 'preview-poster'; image.loading = 'lazy'; image.decoding = 'async'; image.src = poster; image.alt = label;
    state.poster = image; stage.append(image);
  }
  state.toggle = () => interaction(state, !state.interacting); state.enter = () => interaction(state, true);
  state.restart = () => {
    interaction(state, false); release(state);
    state.manual = false; state.priority = true; state.refusals = 0; state.retryAt = 0;
    cooldownUntil = 0; archiveBackoff = 0;
    status(state, 'Waiting for an archive loading slot…'); refreshPreviews();
  };
  button.addEventListener('click', state.toggle); shield.addEventListener('click', state.enter);
  retry.addEventListener('click', state.restart);
  const feedback = document.createElement('div'); feedback.className = 'live-feedback'; feedback.append(message, retry);
  stage.append(shield); wrapper.append(stage, feedback, button);
  if (!manual) status(state, 'Preview queued. Loads as you scroll closer…');
  if (typeof ResizeObserver === 'function') {
    state.resize = new ResizeObserver(() => {
      if (state.frame) state.frame.style.transform = `scale(${stage.clientWidth / 1280})`;
      schedule();
    }); state.resize.observe(stage);
  }
  previews.set(wrapper, state); schedule(); return wrapper;
}

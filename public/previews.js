// Archived pages stay cross-origin. Never use srcdoc or proxy their scripts onto ours.
const previews = new Map();
const safeReplay = input => {
  try {
    const url = new URL(input);
    return url.origin === 'https://web.archive.org' && !url.username && !url.password && /^\/web\/\d{14}(?:if_)?\/https?:\/\//.test(url.pathname) ? url.href : null;
  } catch { return null; }
};
const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const entry of entries) { const state = previews.get(entry.target); if (state) state.near = entry.isIntersecting; }
  refreshPreviews();
}, { rootMargin: '200px 0px' }) : null;
let scheduled = false;
window.addEventListener('scroll', () => {
  if (scheduled || !previews.size) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; refreshPreviews(); });
}, { passive: true });

function pause(state) {
  state.active = false; state.generation++; clearTimeout(state.timer);
  state.frame.onload = state.frame.onerror = null;
  state.frame.removeAttribute('src');
  state.status.textContent = 'Live preview paused. Scroll into view to load.';
}
function destroy(state) {
  pause(state); state.wrapper.dataset.previewDisposed = 'true'; observer?.unobserve(state.wrapper); state.resize?.disconnect(); previews.delete(state.wrapper);
}
function activate(state) {
  state.active = true;
  const generation = ++state.generation;
  state.status.textContent = 'Live replay · Loading from the Internet Archive…';
  state.frame.onload = () => {
    if (state.active && generation === state.generation) {
      clearTimeout(state.timer);
      state.status.textContent = 'Live replay opened. If incomplete, use Open archive.';
    }
  };
  state.frame.onerror = () => {
    if (state.active && generation === state.generation) {
      clearTimeout(state.timer);
      state.status.textContent = 'Replay could not load here. Use Open archive.';
    }
  };
  state.timer = setTimeout(() => {
    if (state.active && generation === state.generation) state.status.textContent = 'The archive is taking a while. You can also use Open archive.';
  }, 15000);
  state.frame.src = state.url;
}

export function refreshPreviews() {
  for (const state of [...previews.values()]) if (!state.wrapper.isConnected) destroy(state);
  const distance = state => { const r = state.wrapper.getBoundingClientRect(); return Math.abs((r.top + r.bottom) / 2 - innerHeight / 2); };
  const near = [...previews.values()].filter(state => state.near).sort((a, b) => distance(a) - distance(b)).slice(0, 2);
  const selected = new Set(near);
  for (const state of previews.values()) if (state.active && !selected.has(state)) pause(state);
  for (const state of near) if (!state.active) activate(state);
}

export function resetPreviews() { for (const state of [...previews.values()]) destroy(state); }

export function livePreview(capture, label) {
  const wrapper = document.createElement('div'); wrapper.className = 'live-preview';
  const stage = document.createElement('div'); stage.className = 'live-stage';
  const status = document.createElement('p'); status.className = 'live-status';
  status.textContent = 'Live replay · Loads when nearby. Archived pages may be incomplete.';
  const url = safeReplay(capture.previewUrl);
  if (!url) { status.textContent = 'Invalid archive preview URL. Use Open archive.'; wrapper.append(status); return wrapper; }
  const frame = document.createElement('iframe'); frame.className = 'live-frame'; frame.title = label;
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.setAttribute('allow', "autoplay 'none'; camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'");
  frame.referrerPolicy = 'no-referrer'; frame.loading = 'lazy'; frame.tabIndex = -1; frame.setAttribute('aria-hidden', 'true');
  const link = document.createElement('a'); link.className = 'live-open-overlay'; link.href = safeReplay(capture.archiveUrl) || url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `Open ${label} in the Wayback Machine`);
  stage.append(frame, link); wrapper.append(stage, status);
  const state = { wrapper, stage, status, frame, url, near: !observer, active: false, generation: 0 };
  if (typeof ResizeObserver === 'function') {
    state.resize = new ResizeObserver(() => { frame.style.transform = `scale(${stage.clientWidth / 1280})`; });
    state.resize.observe(stage);
  }
  previews.set(wrapper, state); observer?.observe(wrapper);
  return wrapper;
}

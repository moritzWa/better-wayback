// Follow rendered cards, never hidden groups or the archive index.
export function timelineNavigation(timeline, prioritizePreview) {
  const nav = document.createElement('nav');
  nav.className = 'timeline-nav'; nav.setAttribute('aria-label', 'Capture timeline'); nav.hidden = true;
  const list = document.createElement('div'); list.className = 'timeline-nav-points';
  const label = document.createElement('label'); label.className = 'timeline-year-picker'; label.append('Jump to capture');
  const select = document.createElement('select'); select.setAttribute('aria-label', 'Jump to capture');
  label.append(select); nav.append(list, label); document.body.append(nav);
  const points = new Map();
  let items = [], frame, active;
  const offset = () => matchMedia('(max-width: 1179px)').matches ? 76 : 24;
  function jump(id) {
    const item = items.find(item => item.entry.id === id);
    if (!item) return;
    prioritizePreview(item.entry);
    window.scrollTo({ top: item.entry.getBoundingClientRect().top + scrollY - offset(), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    // Query history belongs to searches. Do not write location.hash.
  }
  select.addEventListener('change', () => jump(select.value));
  function measure() {
    frame = null;
    const bounds = timeline.getBoundingClientRect();
    nav.hidden = !items.length || bounds.top >= innerHeight || bounds.bottom <= offset();
    if (nav.hidden) return;
    let current = items[0];
    for (const item of items) {
      if (item.entry.getBoundingClientRect().top > offset() + 30) break;
      current = item;
    }
    if (active !== current.entry.id) {
      active = current.entry.id;
      for (const [id, point] of points) {
        if (id === active) point.link.setAttribute('aria-current', 'location');
        else point.link.removeAttribute('aria-current');
      }
      select.value = active;
    }
    // Reveal only inside the rail. scrollIntoView can also move the timeline.
    if (list.clientHeight) {
      const rail = list.getBoundingClientRect();
      const point = points.get(active).link.getBoundingClientRect();
      if (point.top < rail.top) list.scrollTop += point.top - rail.top;
      else if (point.bottom > rail.bottom) list.scrollTop += point.bottom - rail.bottom;
    }
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  const resize = new ResizeObserver(schedule); resize.observe(timeline);
  return {
    update(next) {
      items = next;
      const ids = new Set(items.map(item => item.entry.id));
      for (const [id, point] of points) if (!ids.has(id)) { point.link.remove(); point.option.remove(); points.delete(id); }
      items.forEach((item, index) => {
        const id = item.entry.id;
        let point = points.get(id);
        if (!point) {
          const link = document.createElement('a'); link.href = `#${encodeURIComponent(id)}`;
          link.addEventListener('click', event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); jump(id); });
          const year = document.createElement('span'); year.className = 'timeline-nav-year';
          const dot = document.createElement('span'); dot.className = 'timeline-nav-dot'; dot.setAttribute('aria-hidden', 'true'); link.append(year, dot);
          const option = document.createElement('option'); option.value = id;
          point = { link, year, option }; points.set(id, point);
        }
        point.year.textContent = item.year;
        point.link.setAttribute('aria-label', item.label); point.link.title = item.label; point.link.dataset.state = item.state;
        point.option.textContent = item.label;
        if (list.children[index] !== point.link) list.insertBefore(point.link, list.children[index] || null);
        if (select.children[index] !== point.option) select.insertBefore(point.option, select.children[index] || null);
      });
      active = null; schedule();
    },
    reset() { items = []; points.clear(); list.replaceChildren(); select.replaceChildren(); active = null; nav.hidden = true; },
  };
}

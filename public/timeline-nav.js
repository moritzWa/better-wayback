// Follow rendered cards, never hidden groups or the archive index.
export function timelineNavigation(timeline, prioritizePreview) {
  const nav = document.createElement('nav');
  nav.className = 'timeline-nav'; nav.setAttribute('aria-label', 'Capture timeline'); nav.hidden = true;
  const list = document.createElement('div'); list.className = 'timeline-nav-points';
  const content = document.createElement('div'); content.className = 'timeline-nav-content'; list.append(content);
  const label = document.createElement('label'); label.className = 'timeline-year-picker'; label.append('Jump to capture');
  const select = document.createElement('select'); select.setAttribute('aria-label', 'Jump to capture');
  label.append(select); nav.append(list, label); document.body.append(nav);
  const points = new Map();
  const years = new Map();
  const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
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
    // The final card may not have enough content below it to reach the top.
    // At the natural page end, highlight it without adding artificial space.
    if (Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight && items.at(-1).entry.getBoundingClientRect().top < innerHeight) current = items.at(-1);
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
      const nextYears = new Set(items.map(item => item.year));
      for (const [year, group] of years) if (!nextYears.has(year)) { group.root.remove(); years.delete(year); }
      const monthCounts = new Map();
      for (const item of items) {
        if (!item.timestamp) continue;
        const month = item.timestamp.slice(0, 6);
        monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
      }
      const usedYears = new Set(), positions = new Map();
      items.forEach((item, index) => {
        let group = years.get(item.year);
        if (!group) {
          const root = document.createElement('div'); root.className = 'timeline-nav-group';
          const year = document.createElement('span'); year.className = 'timeline-nav-year'; year.textContent = item.year;
          const captures = document.createElement('div'); captures.className = 'timeline-nav-captures';
          root.append(year, captures); group = { root, captures }; years.set(item.year, group);
        }
        if (!usedYears.has(item.year)) {
          const position = usedYears.size;
          if (content.children[position] !== group.root) content.insertBefore(group.root, content.children[position] || null);
          usedYears.add(item.year);
        }
        const id = item.entry.id;
        let point = points.get(id);
        if (!point) {
          const link = document.createElement('a'); link.href = `#${encodeURIComponent(id)}`;
          link.addEventListener('click', event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); jump(id); });
          const month = document.createElement('span'); month.className = 'timeline-nav-month';
          const dot = document.createElement('span'); dot.className = 'timeline-nav-dot'; dot.setAttribute('aria-hidden', 'true'); link.append(month, dot);
          const option = document.createElement('option'); option.value = id;
          point = { link, month, option }; points.set(id, point);
        }
        let text = '…';
        if (item.timestamp) {
          const month = monthFormat.format(new Date(`${item.timestamp.slice(0, 4)}-${item.timestamp.slice(4, 6)}-01T00:00:00Z`));
          text = monthCounts.get(item.timestamp.slice(0, 6)) > 1 ? `${month} ${Number(item.timestamp.slice(6, 8))}` : month;
        }
        point.month.textContent = text;
        point.link.setAttribute('aria-label', item.label); point.link.title = item.label; point.link.dataset.state = item.state;
        point.option.textContent = item.label;
        const position = positions.get(item.year) || 0;
        if (group.captures.children[position] !== point.link) group.captures.insertBefore(point.link, group.captures.children[position] || null);
        positions.set(item.year, position + 1);
        if (select.children[index] !== point.option) select.insertBefore(point.option, select.children[index] || null);
      });
      active = null; schedule();
    },
    reset() { items = []; points.clear(); years.clear(); content.replaceChildren(); select.replaceChildren(); active = null; nav.hidden = true; },
  };
}

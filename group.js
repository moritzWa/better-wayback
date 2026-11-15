export function cleanText(text) {
  return text.normalize('NFKC').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ').replace(/[\t\r ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
export function similarity(a, b) {
  if (a === b) return 1;
  const shingles = text => {
    const words = cleanText(text).toLowerCase().split(/\s+/);
    return new Set(words.map((_, i) => words.slice(i, i + 3).join(' ')));
  };
  const x = shingles(a), y = shingles(b);
  let common = 0;
  for (const item of x) if (y.has(item)) common++;
  return 2 * common / (x.size + y.size || 1);
}
export function selectCaptures(rows, count = 12) {
  if (rows.length <= count) return rows;
  return Array.from({ length: count }, (_, i) => rows[Math.round(i * (rows.length - 1) / (count - 1))]);
}
export function groupCaptures(captures, threshold = 0.94) {
  const groups = [];
  for (const capture of captures) {
    if (capture.error) continue;
    const previous = groups.at(-1);
    // Compare to the group's first capture so gradual edits don't disappear forever.
    if (previous && similarity(previous.text, capture.text) >= threshold) {
      previous.count++;
      previous.lastTimestamp = capture.timestamp;
    } else {
      groups.push({ ...capture, count: 1, lastTimestamp: capture.timestamp, change: previous ? Math.round((1 - similarity(previous.text, capture.text)) * 100) : null });
    }
  }
  return groups;
}

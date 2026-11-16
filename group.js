export function cleanText(text) {
  return text.normalize('NFKC').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ').replace(/[\t\r ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
const shingleCache = new Map();
const scores = new WeakMap();
function shingles(text) {
  if (shingleCache.has(text)) return shingleCache.get(text);
    const words = cleanText(text).toLowerCase().split(/\s+/);
  const set = new Set(words.map((_, i) => words.slice(i, i + 3).join(' ')));
  if (shingleCache.size >= 64) shingleCache.delete(shingleCache.keys().next().value);
  shingleCache.set(text, set); return set;
}
export function similarity(a, b) {
  if (a === b) return 1;
  const x = shingles(a), y = shingles(b);
  if (scores.get(x)?.has(y)) return scores.get(x).get(y);
  let common = 0;
  for (const item of x) if (y.has(item)) common++;
  const score = 2 * common / (x.size + y.size || 1);
  if (!scores.has(x)) scores.set(x, new WeakMap());
  scores.get(x).set(y, score);
  return score;
}
export function selectCaptures(rows, count = 12) {
  if (rows.length <= count) return rows;
  return Array.from({ length: count }, (_, i) => rows[Math.round(i * (rows.length - 1) / (count - 1))]);
}
export function comparableText(a, b) {
  return Boolean(a && b && !a.textPending && !b.textPending && !a.comparisonUnavailable && !b.comparisonUnavailable && !a.textTruncated && !b.textTruncated && a.text?.trim() && b.text?.trim() && (a.textSource || 'rendered') === (b.textSource || 'rendered'));
}
export function groupCaptures(captures, threshold = 0.94) {
  const groups = [];
  for (const capture of captures) {
    if (capture.error) continue;
    const previous = groups.at(-1);
    // Compare to the group's first capture so gradual edits don't disappear forever.
    const score = comparableText(previous, capture) ? similarity(previous.text, capture.text) : null;
    if (score !== null && score >= threshold) {
      previous.count++;
      previous.lastTimestamp = capture.timestamp;
    } else {
      groups.push({ ...capture, count: 1, lastTimestamp: capture.timestamp, change: score === null ? null : Math.round((1 - score) * 100) });
    }
  }
  return groups;
}

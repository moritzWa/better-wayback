import { createHash } from 'node:crypto';
export { cleanText, similarity, selectCaptures, groupCaptures } from './group.js';

export const USER_AGENT = 'BetterWayback/0.1 (research prototype; gpt-6.1-sol)';
export function normalizeUrl(input) {
  const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password || url.port) throw new Error('Enter a public website URL without credentials or a custom port.');
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) throw new Error('Enter a public website URL.');
  url.hash = '';
  return url.href;
}
export const keyFor = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
export function replayUrl(timestamp, original, raw = false) {
  if (!/^\d{14}$/.test(timestamp)) throw new Error('Invalid capture timestamp');
  return `https://web.archive.org/web/${timestamp}${raw ? 'id_' : ''}/${original}`;
}
export async function fetchCaptures(url, from, to) {
  const params = new URLSearchParams({ url, output: 'json', filter: 'statuscode:200', collapse: 'digest', fl: 'timestamp,original,digest', from, to, limit: '1200' });
  const request = async () => {
    const response = await fetch(`https://web.archive.org/cdx/search/cdx?${params}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`Wayback returned ${response.status}. Please try again later.`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Unexpected response from Wayback.');
    return data.slice(1).filter(row => /^\d{14}$/.test(row[0]) && /^https?:\/\//.test(row[1])).map(([timestamp, original, digest]) => ({ timestamp, original, digest }));
  };
  let rows = await request();
  const total = rows.length, capped = total === 1200;
  if (capped) {
    // A dense site's first 1,200 captures may cover only its early years.
    // One candidate per month covers the requested span without huge queries.
    params.set('collapse', 'timestamp:6');
    rows = await request();
  }
  rows.indexTotal = total;
  rows.indexCapped = capped;
  return rows;
}

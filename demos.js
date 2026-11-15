import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const demoNames = ['stripe', 'amazon'];
// Runtime deliberately imports no browser, worker or archive client.
export async function loadDemo(name, root = resolve('.')) {
  if (!demoNames.includes(name)) return null;
  return JSON.parse(await readFile(resolve(root, 'demos', `${name}.json`), 'utf8'));
}

export async function demoAsset(path, root = resolve('.')) {
  const match = path.match(/^\/demos\/(stripe|amazon)\/(\d{14}-[a-f0-9]{24}\.png)$/);
  if (!match) return null;
  const demo = await loadDemo(match[1], root);
  if (!demo.captures.some(capture => capture.image === path)) return null;
  return readFile(resolve(root, 'public', path.slice(1)));
}

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { examples } from './public/examples.js';

export const demoNames = examples.map(example => example.id);
// Runtime deliberately imports no browser, worker or archive client.
export async function loadDemo(name, root = resolve('.')) {
  if (!demoNames.includes(name)) return null;
  return JSON.parse(await readFile(resolve(root, 'demos', `${name}.json`), 'utf8'));
}

export async function demoAsset(path, root = resolve('.')) {
  const match = path.match(/^\/demos\/([a-z]+)\/(\d{14}-[a-f0-9]{24}\.png)$/);
  if (!match || !demoNames.includes(match[1])) return null;
  const demo = await loadDemo(match[1], root);
  if (!demo.captures.some(capture => capture.image === path)) return null;
  return readFile(resolve(root, 'public', path.slice(1)));
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleBlogRequest } from '../blog.js';

test('the original outlined brand and favicon ship without external fonts or scripts', async()=>{
  for(const file of ['logo.svg','favicon.svg']){
    const svg=await readFile(new URL('../public/'+file,import.meta.url),'utf8');
    assert.match(svg,/<svg[^>]+viewBox=/);
    assert.match(svg,/Visual Wayback/);
    assert.doesNotMatch(svg,/<(?:script|text|foreignObject)\b|https?:\/\/(?!www\.w3\.org)/i);
  }
  for(const [file,size]of [['favicon-32.png',32],['apple-touch-icon.png',180],['icon-512.png',512]]){
    const png=await readFile(new URL('../public/'+file,import.meta.url));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
  }
  const ico=await readFile(new URL('../public/favicon.ico',import.meta.url));assert.equal(ico.subarray(0,4).toString('hex'),'00000100');
  assert.match(await readFile(new URL('../tools/brand/OFL.txt',import.meta.url),'utf8'),/SIL OPEN FONT LICENSE/);
});

test('app and blog pages advertise the same brand and favicon assets',async()=>{
  for(const html of [await readFile(new URL('../public/index.html',import.meta.url),'utf8'),handleBlogRequest('/blog/').body,handleBlogRequest('/blog/history-of-the-wayback-machine/').body]){
    for(const path of ['/logo.svg','/favicon.svg','/favicon-32.png','/favicon.ico','/apple-touch-icon.png'])assert.ok(html.includes(path),path);
    assert.match(html,/alt="Visual Wayback"/);
    assert.match(html,/Not affiliated with the Internet Archive/);
  }
});

// Deterministic client regression for the reported Amazon 24-capture/98% flow.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { launchRendererBrowser } from '../renderer.js';
const server = spawn(process.execPath, ['server.js'], { env: {...process.env, PORT:'0'}, stdio:['ignore','pipe','inherit'] });
let browser;
try {
  const base = await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('server startup deadline')),10000);
    server.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/localhost:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
  });
  browser=await launchRendererBrowser(); const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(()=>{
    window.connections=[];
    window.EventSource=class {constructor(){window.connections.push(this);}close(){}};
    window.emit=event=>window.connections.at(-1).onmessage({data:JSON.stringify(event)});
  });
  let jobs=0, respond;
  await page.route('**/api/jobs',async route=>{
    jobs++; assert.equal(route.request().postDataJSON().count,'24');
    await new Promise(resolve=>respond=resolve);
    await route.fulfill({json:jobs===1?{id:'a'.repeat(24),url:'https://amazon.com/'}:{error:'The Internet Archive index is responding too slowly. Retry later; this is not evidence that the page has no captures.'},status:jobs===1?202:502});
  });
  await page.route('https://web.archive.org/**',route=>route.fulfill({contentType:'text/html',body:'<p>Delayed archive fixture</p>'}));
  await page.goto(`${base}/?url=amazon.com&count=24`);
  await page.waitForFunction(()=>document.querySelectorAll('.entry-pending').length===24);
  await page.locator('#sensitivity').evaluate(n=>{n.value='98';n.dispatchEvent(new Event('input'));});
  await page.waitForFunction(()=>document.querySelector('#sensitivity-value').textContent==='98%');
  assert.equal(jobs,1); assert.equal(await page.locator('.entry-pending').count(),24);
  respond(); await page.waitForFunction(()=>window.connections.length===1);
  await page.evaluate(()=>{
    const captures=Array.from({length:24},(_,i)=>({timestamp:`${2000+i}0101000000`,original:'https://amazon.com/',archiveUrl:`https://web.archive.org/web/${2000+i}0101000000/https://amazon.com/`,previewUrl:`https://web.archive.org/web/${2000+i}0101000000if_/https://amazon.com/`,text:Array.from({length:1800},(_,n)=>`word${n+i*2}`).join(' ').slice(0,12000),textSource:'html',textPending:false}));
    window.emit({type:'index',total:1200,capped:true,timeSampled:true,sampled:24,captures});
    for(const capture of captures) window.emit({type:'capture',capture});
    window.emit({type:'done'});
  });
  await page.locator('#all-view').click();
  assert.equal(await page.locator('.timeline-entry').count(),24);
  assert.match(await page.locator('#stats').innerText(),/Time-sampled index · 24\/24 sampled/);
  const ms=await page.evaluate(async()=>{
    const start=performance.now(),slider=document.querySelector('#sensitivity');
    window.firstPreview=document.querySelector('.timeline-entry iframe');
    for(let i=0;i<100;i++){slider.value=String(90+i%10);slider.dispatchEvent(new Event('input'));}
    slider.value='98';slider.dispatchEvent(new Event('input'));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return performance.now()-start;
  });
  assert.ok(ms<1000,`100 slider updates blocked for ${ms}ms`);
  assert.equal(jobs,1,'Similarity changes must never restart archive lookup');
  assert.ok(await page.evaluate(()=>window.firstPreview===document.querySelector('.timeline-entry iframe')),'Slider must preserve the mounted preview');
  await page.locator('#search-button').click();
  await page.waitForFunction(()=>document.querySelectorAll('.entry-pending').length===24);
  respond();
  await page.waitForFunction(()=>!document.querySelector('#search-button').disabled);
  assert.match(await page.locator('#stats').innerText(),/lookup failed/);
  assert.equal(await page.locator('#empty-state').isVisible(),false,'Index failure is not an empty history');
  assert.equal(await page.locator('.entry-pending').count(),0);
  await page.locator('#sensitivity').evaluate(n=>{n.value='97';n.dispatchEvent(new Event('input'));}); await page.waitForTimeout(100);
  assert.equal(await page.locator('#empty-state').isVisible(),false);
  assert.match(await page.locator('#error').innerText(),/index is responding too slowly/);
  console.log(`PASS Amazon 24-capture/98% fixture: pending slider safe, no repeated lookup, 24 results, 100 slider updates ${Math.round(ms)}ms, stable iframe, honest timeout state.`);
} finally {await browser?.close();server.kill('SIGTERM');await once(server,'exit');}

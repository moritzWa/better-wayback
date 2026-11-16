// Real Prime Intellect archive scrolling in a dedicated muted Linux Space.
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const phase=process.env.SCROLL_PHASE||'after';
const base=process.env.LIVE_BASE||'https://visualwayback.com';
const output=process.env.SCROLL_OUTPUT||join(homedir(),'Documents/visual-wayback/scroll-fix');await mkdir(output,{recursive:true});
const browser=await chromium.connectOverCDP(process.env.SCROLL_CDP||'http://localhost:19833');
let context;
const result={phase,base,startedAt:new Date().toISOString(),steps:[]};
try{
 context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.addInitScript(()=>{
  window.__previewAudit=[];
  const seen=new WeakMap();
  const sample=frame=>{const src=frame.getAttribute('src');if(!seen.has(frame)||seen.get(frame)!==src){window.__previewAudit.push({ms:performance.now(),src,old:seen.get(frame)||null});seen.set(frame,src)}};
  new MutationObserver(records=>{for(const record of records){
   if(record.type==='attributes'&&record.target.tagName==='IFRAME')sample(record.target);
   for(const node of record.addedNodes||[])if(node.nodeType===1){if(node.tagName==='IFRAME')sample(node);for(const frame of node.querySelectorAll('iframe'))sample(frame)}
  }}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['src'],attributeOldValue:true});
 });
 const page=await context.newPage();
 await page.goto(`${base}/?url=primeintellect.ai`);
 await page.waitForSelector('.timeline-entry',{timeout:45000});
 await page.locator('#all-view').click();
 await page.locator('.timeline-entry').first().scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>!document.querySelector('#search-button').disabled,{},{timeout:60000});
 const count=await page.locator('.timeline-entry').count();assert.ok(count>=4,'Real history must include several captures');
 result.captureCount=count;result.deviceMemory=await page.evaluate(()=>navigator.deviceMemory||null);result.stats=await page.locator('#stats').innerText();result.partialError=await page.locator('#error').innerText();
 const firstFrame=page.locator('.timeline-entry').first().locator('iframe');
 await page.waitForFunction(()=>document.querySelector('.timeline-entry iframe')?.getAttribute('src'),{},{timeout:20000});
 const firstChild=await(await firstFrame.elementHandle()).contentFrame();
 await firstChild.waitForFunction(()=>/Prime|compute|intelligence|Projects/i.test(document.body?.innerText||''),{},{timeout:45000});
 result.firstReplay={url:firstChild.url(),text:(await firstChild.locator('body').innerText()).slice(0,450)};
 // Give nearby preloads a head start, then repeat the user's short down/up reversal.
 await page.waitForTimeout(3500);
 for(const index of [0,1,2,3,2,1,0]){
  await page.locator('.timeline-entry').nth(index).evaluate(entry=>entry.scrollIntoView({behavior:'instant',block:'start'}));await page.waitForTimeout(450);
  result.steps.push(await page.evaluate(index=>({index,outerY:scrollY,mounted:document.querySelectorAll('iframe[src]').length,firstMounted:!!document.querySelector('.timeline-entry iframe')?.getAttribute('src'),assignments:window.__previewAudit.filter(e=>e.src).length}),index));
 }
 await page.screenshot({path:`${output}/${phase}-returned-top.png`});
 result.audit=await page.evaluate(()=>window.__previewAudit);
 const firstURL=await firstFrame.getAttribute('src');
 result.firstURL=firstURL;
 result.firstSourceAssignments=result.audit.filter(e=>e.src&&e.src.includes('/web/'+(firstURL?.match(/\/web\/(\d{14})/)?.[1]||'missing'))).length;
 if(phase==='after'){
  assert.equal(result.firstSourceAssignments,1,'Returning to the first few cards must not reload their documents');
  assert.equal(await firstFrame.getAttribute('sandbox'),'allow-scripts allow-same-origin');
  assert.equal(await page.evaluate(()=>document.querySelector('.timeline-entry iframe').contentDocument),null);
  const action=page.locator('.timeline-entry').first().locator('.preview-interact-button');
  await action.click();await page.waitForTimeout(400);
  const child=await(await firstFrame.elementHandle()).contentFrame();
  const outerBefore=await page.evaluate(()=>scrollY);
  const innerBefore=await child.evaluate(()=>scrollY);
  const box=await firstFrame.boundingBox();
  await page.mouse.move(box.x+Math.min(300,box.width/2),box.y+Math.min(220,box.height/2));await page.mouse.wheel(0,450);await page.waitForTimeout(500);
  const innerAfter=await child.evaluate(()=>scrollY),outerAfter=await page.evaluate(()=>scrollY);
  result.interaction={outerBefore,outerAfter,innerBefore,innerAfter};
  assert.ok(innerAfter>innerBefore,'Real archive document should scroll in interaction mode');
  assert.ok(Math.abs(outerAfter-outerBefore)<5,'Interaction mode should not scroll the outer timeline');
  // Archive subresources can leave load pending after the page is usable.
  await page.waitForTimeout(22000);
  assert.equal(await firstFrame.getAttribute('src'),firstURL,'A usable interacting replay must survive the loading deadline');
  assert.equal(await child.evaluate(()=>scrollY),innerAfter,'Loading deadline must preserve inner scroll position');
  await action.click();
  await page.screenshot({path:`${output}/${phase}-interaction.png`});
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  await page.locator('#url').focus();
  assert.equal(await page.locator('#sampling-note').isVisible(),false);
  assert.equal(await page.locator('#url').evaluate(input=>getComputedStyle(input).outlineStyle),'none');
  await page.screenshot({path:`${output}/${phase}-search-focus.png`});
 }
 await writeFile(`${output}/${phase}-real-scroll.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify({phase,captures:count,firstSourceAssignments:result.firstSourceAssignments,steps:result.steps,interaction:result.interaction,partialError:result.partialError}));
}catch(error){result.error=error.stack;await writeFile(`${output}/${phase}-real-scroll.json`,JSON.stringify(result,null,2));throw error}
finally{
 await context?.close();
 if(phase!=='before'){try{const session=await browser.newBrowserCDPSession();await session.send('Browser.close')}catch{}}
 await browser.close().catch(()=>{});
}

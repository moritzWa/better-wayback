// Continuous native-4K browser screencast. Only the outer Visual Wayback page scrolls.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const root=resolve(process.env.DEMO_OUTPUT||'/Users/m/Documents/visual-wayback/demo-video/screen-record');
const hires=resolve('/Users/m/Documents/visual-wayback/demo-video/high-res');
await mkdir(resolve(root,'frames'),{recursive:true});
const sources=JSON.parse(await readFile(resolve(hires,'capture.json'),'utf8')).sources;
sources.push(...JSON.parse(await readFile(resolve('/Users/m/Documents/visual-wayback/demo-video/apple','capture.json'),'utf8')).sources);
const latest=JSON.parse(await readFile(resolve('/Users/m/Documents/visual-wayback/demo-video/latest','capture.json'),'utf8')).sources;
sources.push(...latest);
const browser=await chromium.connectOverCDP(process.env.DEMO_CDP||'http://localhost:19832');
let context,session,started,error;
const frames=[],writes=[],scenes=[];
function jpegSize(buffer){
  let p=2;
  while(p<buffer.length){
    if(buffer[p++]!==255)continue;
    const marker=buffer[p++];
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return [buffer.readUInt16BE(p+5),buffer.readUInt16BE(p+3)];
    if(marker===0xd8||marker===0xd9)continue;
    p+=buffer.readUInt16BE(p);
  }
  throw new Error('Cannot verify screencast JPEG dimensions');
}
try{
  // Physical viewport, not a 1280px screencast enlarged using deviceScaleFactor.
  context=await browser.newContext({viewport:{width:3840,height:2160},deviceScaleFactor:1,serviceWorkers:'block'});
  await context.route('**/demos/**/*.png',async route=>{
    const source=sources.find(s=>new URL(route.request().url()).pathname===s.image);
    if(source)await route.fulfill({contentType:'image/png',body:await readFile(source.file)});else await route.continue();
  });
  const page=await context.newPage();
  await page.goto('https://visualwayback.com/');
  await page.waitForFunction(()=>!document.querySelector('#search-button').disabled);
  // Browser presentation zoom keeps text readable at a physical 4K capture size.
  // This is not an editing transform: every pixel below is emitted by Chromium.
  await page.evaluate(()=>{document.body.style.zoom='3';document.documentElement.style.scrollBehavior='auto';});
  async function ready(name){
    await page.locator(`[data-site="${name}.com"]`).click();
    await page.waitForFunction(()=>!document.querySelector('#search-button').disabled);
    await page.locator('#all-view').click();
    await page.locator('#timeline img').evaluateAll(images=>Promise.all(images.map(n=>{n.loading='eager';return n.decode()})));
    if(await page.locator('iframe').count())throw new Error('Archived iframe must not be scrolled or recorded');
  }
  async function position(name,timestamp){
    return page.locator(`img[src^="/demos/${name}/${timestamp}-"]`).evaluate(n=>n.closest('.timeline-entry').getBoundingClientRect().top+scrollY-72);
  }
  async function timestamps(name,from){
    const result=await page.locator('#timeline img').evaluateAll(images=>images.map(n=>n.getAttribute('src').match(/\/(\d{14})-/)?.[1]).filter(Boolean));
    const selected=result.filter(t=>!from||t>=from);
    if(selected.length!==4)throw new Error(`Expected four consecutive ${name} cards, got ${selected.length}`);
    if(selected.at(-1)!==latest.find(s=>s.name===name)?.timestamp)throw new Error(`${name} does not end at its newest verified capture`);
    return selected;
  }
  for(const name of ['openai','apple','nvidia'])await ready(name);
  await page.evaluate(()=>scrollTo(0,0));await page.mouse.move(140,1100);await page.waitForTimeout(350);
  session=await context.newCDPSession(page);
  let first;const firstFrame=new Promise(resolve=>{first=resolve});
  session.on('Page.screencastFrame',event=>{
    const now=performance.now();started??=now;
    const data=Buffer.from(event.data,'base64');
    const pixels=jpegSize(data);
    if(pixels[0]!==3840||pixels[1]!==2160)error=new Error(`Native screen recording is ${pixels.join('x')}, not 3840x2160. Refusing to upscale.`);
    const file=`frames/${String(frames.length).padStart(6,'0')}.jpg`;
    frames.push({file,seconds:(now-started)/1000,sourceTimestamp:event.metadata.timestamp,pixels});
    writes.push(writeFile(resolve(root,file),data));
    void session.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});first();
  });
  await session.send('Page.startScreencast',{format:'jpeg',quality:95,maxWidth:3840,maxHeight:2160,everyNthFrame:1});
  await firstFrame;if(error)throw error;
  const elapsed=()=>(performance.now()-started)/1000;
  async function scroll(y,ms){
    return page.evaluate(async({y,ms})=>{
      const start=performance.now(),from=scrollY,trace=[];
      await new Promise(resolve=>{
        const frame=now=>{
          const p=Math.min(1,(now-start)/ms),e=p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;
          window.scrollTo(0,from+(y-from)*e);
          trace.push({ms:now-start,outerY:scrollY,innerScrolled:[...document.querySelectorAll('.timeline-entry *')].filter(n=>n.scrollTop!==0).length});
          if(p<1)requestAnimationFrame(frame);else resolve();
        };requestAnimationFrame(frame);
      });return trace;
    },{y,ms});
  }
  let start=elapsed();await page.waitForTimeout(250);
  const introDates=await timestamps('nvidia');let trace=[];
  for(const timestamp of introDates){trace.push(...await scroll(await position('nvidia',timestamp),540));await page.waitForTimeout(220)}
  await page.waitForTimeout(300);
  scenes.push({name:'intro',site:'nvidia',start,end:elapsed(),trace,timestamps:introDates,outerPageOnly:true});
  for(const name of ['openai','apple']){
    await ready(name);const dates=await timestamps(name,name==='openai'?'20220101000000':null);
    await page.evaluate(y=>scrollTo(0,y),await position(name,dates[0]));await page.waitForTimeout(300);
    start=elapsed();trace=[];await page.waitForTimeout(220);
    for(const timestamp of dates.slice(1)){trace.push(...await scroll(await position(name,timestamp),640));await page.waitForTimeout(220)}
    await page.waitForTimeout(150);
    scenes.push({name,site:name,start,end:elapsed(),trace,timestamps:dates,outerPageOnly:true});
  }
  await session.send('Page.stopScreencast');session.removeAllListeners('Page.screencastFrame');await Promise.all(writes);
  if(error)throw error;
  for(const scene of scenes){
    if(scene.trace.some(p=>p.innerScrolled))throw new Error('An inner preview scrolled; only the Visual Wayback page should move.');
    if(new Set(scene.trace.map(p=>p.outerY)).size<30)throw new Error('Outer page did not scroll continuously.');
    const movingFrames=frames.filter(f=>f.seconds>=scene.start&&f.seconds<=scene.end);
    if(movingFrames.length<24)throw new Error(`Too few live screencast frames for ${scene.name}: ${movingFrames.length}`);
  }
  await writeFile(resolve(root,'recording.json'),JSON.stringify({source:'https://visualwayback.com/',mode:'continuous-live-CDP-screencast',viewport:[3840,2160],browserPresentationZoom:3,deviceScaleFactor:1,frames,scenes,noEditingCameraTransforms:true,outerPageOnly:true,noComparisonDialog:true},null,2));
  console.log(JSON.stringify({nativePixels:frames[0].pixels,frames:frames.length,scenes:scenes.map(s=>({name:s.name,start:s.start,end:s.end,outerPositions:new Set(s.trace.map(p=>p.outerY)).size})),root}));
}finally{
  await context?.close();try{const s=await browser.newBrowserCDPSession();await s.send('Browser.close')}catch{}await browser.close().catch(()=>{});
}

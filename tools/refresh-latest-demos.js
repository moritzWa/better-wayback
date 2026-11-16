// Append the newest verified genuine Archive captures; never relabel old pages as current.
import { chromium } from 'playwright';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { archiveRequestAllowed,renderPage } from '../renderer.js';
import { USER_AGENT,RENDER_VERSION,isArchiveErrorPage } from '../lib.js';
import { cleanText } from '../group.js';

const root=resolve('/Users/m/Documents/visual-wayback/demo-video/latest');await mkdir(root,{recursive:true});
const browser=await chromium.connectOverCDP(process.env.DEMO_CDP||'http://localhost:19832');
const sources=[],checks=[];
async function currentApple(){
 const name='apple',url='https://www.apple.com/',file=resolve(root,'apple-current.png');
 const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:3,serviceWorkers:'block'});
 let capture;
 try{
  const page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000});
  await page.waitForTimeout(6000);await page.evaluate(()=>document.fonts.ready);
  const title=await page.title(),text=cleanText(await page.locator('body').innerText());
  if(isArchiveErrorPage(title,text)||text.length<100||!text.includes('Apple HomeView'))throw new Error('Current Apple homepage did not load');
  const broken=await page.evaluate(()=>[...document.images].filter(n=>{const r=n.getBoundingClientRect();return r.width>50&&r.height>50&&r.top<innerHeight&&r.bottom>0&&!n.naturalWidth}).length);
  if(broken)throw new Error('Current Apple hero has missing images');
  await page.screenshot({path:file,scale:'device'});
  const capturedAt=new Date().toISOString(),timestamp=capturedAt.replace(/\D/g,'').slice(0,14);
  capture={timestamp,original:url,title,text,sourceType:'live',sourceUrl:url,archiveUrl:url,capturedAt,textSource:'live-rendered'};
  await writeFile(file+'.json',JSON.stringify(capture,null,2));
 }finally{await context.close()}
 const resized=spawnSync('python3',['-c','from PIL import Image; import sys; Image.open(sys.argv[1]).resize((1280,800),Image.Resampling.LANCZOS).save(sys.stdout.buffer,format="PNG")',file],{maxBuffer:8*1024*1024});
 if(resized.status!==0)throw new Error('Could not package the live Apple capture');
 const png=resized.stdout,sha256=createHash('sha256').update(png).digest('hex'),image=`/demos/apple/${capture.timestamp}-${sha256.slice(0,24)}.png`;
 await writeFile(resolve('public',image.slice(1)),png);
 const demo=JSON.parse(await readFile('demos/apple.json','utf8'));demo.captures=demo.captures.filter(c=>c.sourceType!=='live');demo.captures.push({...capture,image,sha256,renderVersion:RENDER_VERSION});demo.captures.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
 demo.count=demo.sampled=demo.captures.length;demo.total=Math.max(demo.total,demo.count);demo.lastTimestamp=capture.timestamp;demo.to=capture.timestamp.slice(0,4);demo.source='Internet Archive history and an explicitly labelled current website capture';demo.indexNote='Three genuine archived captures plus a separately labelled live-site capture. The Current card is not an archive replay.';
 await writeFile('demos/apple.json',JSON.stringify(demo,null,2));
 sources.push({name,timestamp:capture.timestamp,image,file,title:capture.title,sourceType:'live',sourceUrl:url});checks.push({name,sourceType:'live',capturedAt:capture.capturedAt,liveTitle:capture.title,hero:'Apple HomeView'});
 console.log(JSON.stringify({name,timestamp:capture.timestamp,captures:demo.count,sourceType:'live',title:capture.title}));
}
try{
 for(const[name,url]of [['nvidia','https://www.nvidia.com/en-us/'],['openai','https://openai.com/'],['apple','https://www.apple.com/']]){
  if(name==='apple'){await currentApple();continue}
  const available=JSON.parse(await readFile(resolve(root,name+'-available.json'),'utf8')).archived_snapshots.closest;
  if(!available?.available||available.status!=='200'||available.timestamp<'20261001000000')throw new Error(`No recent genuine ${name} capture available`);
  const file=resolve(root,`${name}-${available.timestamp}.png`);let result;
  try{result=JSON.parse(await readFile(file+'.json','utf8'));await readFile(file)}catch{
   const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:3,userAgent:USER_AGENT,serviceWorkers:'block',acceptDownloads:false});
   const deadline=setTimeout(()=>{void context.close()},95000);
   try{
    await context.route('**/*',r=>archiveRequestAllowed(r.request().url())?r.continue():r.abort());
    await context.routeWebSocket('**/*',s=>s.close());
    context.on('page',p=>{p.on('dialog',d=>d.dismiss());p.on('popup',q=>q.close())});
    const archivePage=await context.newPage();
    try{result=await renderPage(archivePage,{timestamp:available.timestamp,original:url},file,{readinessTimeoutMs:50000})}
    catch(error){await archivePage.screenshot({path:resolve(root,`${name}-failed-check.png`),scale:'device'}).catch(()=>{});throw error}
    if(result.timestamp<'20261001000000')throw new Error('Replay redirected to an older design');
    await writeFile(file+'.json',JSON.stringify(result,null,2));
   }finally{clearTimeout(deadline);await context.close()}
  }
  const resized=spawnSync('python3',['-c','from PIL import Image; import sys; im=Image.open(sys.argv[1]); im.resize((1280,800),Image.Resampling.LANCZOS).save(sys.stdout.buffer,format="PNG")',file],{maxBuffer:8*1024*1024});
  if(resized.status!==0)throw new Error('Could not package current capture');
  const png=resized.stdout,sha256=createHash('sha256').update(png).digest('hex'),image=`/demos/${name}/${result.timestamp}-${sha256.slice(0,24)}.png`;
  await writeFile(resolve('public',image.slice(1)),png);
  const demo=JSON.parse(await readFile(`demos/${name}.json`,'utf8'));
  demo.captures=demo.captures.filter(c=>c.timestamp!==result.timestamp);demo.captures.push({...result,image,sha256,renderVersion:RENDER_VERSION});demo.captures.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
  demo.count=demo.sampled=demo.captures.length;demo.total=Math.max(demo.total,demo.count);demo.lastTimestamp=demo.captures.at(-1).timestamp;demo.to=demo.lastTimestamp.slice(0,4);
  demo.indexNote='Curated historical captures plus a recent capture verified through the Internet Archive availability API. Not a complete capture index.';
  await writeFile(`demos/${name}.json`,JSON.stringify(demo,null,2));
  sources.push({name,timestamp:result.timestamp,image,file,title:result.title,archiveUrl:result.archiveUrl});
  // Photograph the live homepage only for a separate visual verification, never as a fake archived point.
  const live=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:3,serviceWorkers:'block'});
  try{
   const page=await live.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000});await page.waitForTimeout(5000);
   const details=await page.evaluate(()=>({url:location.href,title:document.title,headings:[...document.querySelectorAll('h1,h2')].map(n=>n.innerText).filter(Boolean).slice(0,15),text:document.body.innerText.slice(0,3000)}));
   await page.screenshot({path:resolve(root,`${name}-live-check.png`),scale:'device'});
   checks.push({name,archiveTimestamp:result.timestamp,archiveTitle:result.title,archiveText:result.text.slice(0,3000),live:details});
  }catch(error){checks.push({name,archiveTimestamp:result.timestamp,liveCheckError:error.message})}finally{await live.close()}
  console.log(JSON.stringify({name,timestamp:result.timestamp,title:result.title,captures:demo.count,liveCheck:checks.at(-1).live?.title||checks.at(-1).liveCheckError}));
  await writeFile(resolve(root,'capture.json'),JSON.stringify({sources,checks},null,2));
 }
 await writeFile(resolve(root,'capture.json'),JSON.stringify({sources,checks},null,2));
}finally{await browser.close()}

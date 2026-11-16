// Curate genuine Apple captures at native DPR 3 for both the preset and the demo.
import { chromium } from 'playwright';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { archiveRequestAllowed,renderPage } from '../renderer.js';
import { USER_AGENT,RENDER_VERSION } from '../lib.js';

const root=resolve(process.env.APPLE_DEMO_DIR||'/Users/m/Documents/visual-wayback/demo-video/apple');
const rows=JSON.parse(await readFile(resolve(root,'candidates.json'),'utf8'));
const browser=await chromium.connectOverCDP(process.env.DEMO_CDP||'http://localhost:19832');
const captures=[],unavailable=[],sources=[];
try{
 for(const year of ['1999','2007','2012']){
  for(const candidate of rows.filter(c=>c.timestamp.startsWith(year))){
   const file=resolve(root,`apple-${candidate.timestamp}.png`);let result;
   try{
    try{result=JSON.parse(await readFile(file+'.json','utf8'));await readFile(file)}catch{
     const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:3,userAgent:USER_AGENT,serviceWorkers:'block',acceptDownloads:false});
     const deadline=setTimeout(()=>{void context.close()},95000);
     try{
      await context.route('**/*',route=>archiveRequestAllowed(route.request().url())?route.continue():route.abort());
      await context.routeWebSocket('**/*',socket=>socket.close());
      context.on('page',p=>{p.on('dialog',d=>d.dismiss());p.on('popup',q=>q.close())});
      result=await renderPage(await context.newPage(),candidate,file,{readinessTimeoutMs:45000});
      await writeFile(file+'.json',JSON.stringify(result,null,2));
     }finally{clearTimeout(deadline);await context.close()}
    }
    // Match the existing 1280×800 public demo contract; retain native DPR-3 originals
    // separately for the recording browser, as for the other high-resolution scenes.
    const resized=spawnSync('python3',['-c','from PIL import Image; import sys; im=Image.open(sys.argv[1]); im.resize((1280,800),Image.Resampling.LANCZOS).save(sys.stdout.buffer,format="PNG")',file],{maxBuffer:8*1024*1024});
    if(resized.status!==0)throw new Error('Failed to package the standard-size Apple preview');
    const png=resized.stdout,sha256=createHash('sha256').update(png).digest('hex');
    const image=`/demos/apple/${result.timestamp}-${sha256.slice(0,24)}.png`;
    await mkdir('public/demos/apple',{recursive:true});await writeFile(resolve('public',image.slice(1)),png);
    captures.push({...result,image,sha256,renderVersion:RENDER_VERSION});
    sources.push({name:'apple',timestamp:result.timestamp,image,file,title:result.title,archiveUrl:result.archiveUrl});
    console.log(JSON.stringify({timestamp:result.timestamp,title:result.title,image}));break;
   }catch(error){unavailable.push({...candidate,error:error.message});console.log(JSON.stringify({timestamp:candidate.timestamp,error:error.message}));if(/HTTP (429|503)|rate limit/i.test(error.message))throw error}
  }
 }
 await writeFile('demos/apple-attempts.json',JSON.stringify({url:'https://www.apple.com/',unavailable},null,2));
 if(captures.length<3)throw new Error('Fewer than three usable Apple captures; do not publish a partial preset.');
 captures.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
 const firstTimestamp=captures[0].timestamp,lastTimestamp=captures.at(-1).timestamp;
 await writeFile('demos/apple.json',JSON.stringify({url:'https://www.apple.com/',from:firstTimestamp.slice(0,4),to:lastTimestamp.slice(0,4),firstTimestamp,lastTimestamp,count:captures.length,total:rows.filter(r=>['1999','2007','2012'].includes(r.timestamp.slice(0,4))).length,sampled:captures.length,capped:false,cached:true,status:'ready',curated:true,source:'Internet Archive Wayback Machine',indexNote:'Curated from year-specific CDX queries, not the complete capture index.',captures,unavailable},null,2));
 await writeFile(resolve(root,'capture.json'),JSON.stringify({sources,pixels:[3840,2400],years:['1999','2007','2012']},null,2));
}finally{await browser.close()}

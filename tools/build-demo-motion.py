"""Short motion edit: real scrolling, official Archive logo, focused camera and new voice."""
import argparse, bisect, json, math, pathlib, shutil, subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

parser=argparse.ArgumentParser()
parser.add_argument('--input',default='/Users/m/Documents/visual-wayback/demo-video/motion')
parser.add_argument('--output',default='/Users/m/Desktop/visual-wayback-demo.mp4')
parser.add_argument('--overwrite',action='store_true')
args=parser.parse_args(); root=pathlib.Path(args.input); output=pathlib.Path(args.output)
if output.exists() and not args.overwrite: raise SystemExit('Inspect the existing video before using --overwrite.')
capture=json.loads((root/'capture.json').read_text())
assert capture['pixels']==[3840,2160] and capture['noComparisonDialog']
for scene in capture['scenes']:
    assert len(scene['frames'])==120 and len(set(f['scrollY'] for f in scene['frames']))>=40

W,H,FPS=3840,2160,30
REG='/System/Library/Fonts/Supplemental/Arial.ttf'; BOLD='/System/Library/Fonts/Supplemental/Arial Bold.ttf'
def font(size,bold=False): return ImageFont.truetype(BOLD if bold else REG,size)
def ease(t):
    t=max(0,min(1,t)); return t*t*(3-2*t)
def text(layer,value,xy,size,color='#1d1d1f',bold=False,anchor=None):
    ImageDraw.Draw(layer).text(xy,value,font=font(size,bold),fill=color,anchor=anchor)
def reveal(canvas,layer,t,delay=0,duration=.36,rise=45):
    p=ease((t-delay)/duration)
    if p<=0:return
    if p<1:layer.putalpha(layer.getchannel('A').point(lambda a:round(a*p)))
    canvas.alpha_composite(layer,(0,round((1-p)*rise)))

intro=Image.open(root/'intro.png').convert('RGB'); assert intro.size==(W,H)
logo=Image.open(root/'internet-archive-logo.png').convert('RGBA')
frames_dir=root/'edit-frames';frames_dir.mkdir(exist_ok=True)
scenes=[('intro',108),('problem',102),('openai',87),('nvidia',87),('cta',108)]
assert sum(n for _,n in scenes)==492
index=0; timeline=[]
for name,count in scenes:
    timeline.append({'name':name,'start':index/FPS,'duration':count/FPS})
    source_scene=next((s for s in capture['scenes'] if s['name']==name),None)
    for i in range(count):
        t=i/FPS; p=i/max(1,count-1)
        if name=='intro':
            frame=Image.new('RGBA',(W,H),'#f7f7f9')
            # The app is visible from the first frame. Camera movement stays below native size.
            scale=.52+.025*ease(p);size=(round(W*scale),round(H*scale))
            frame.paste(intro.resize(size,Image.Resampling.LANCZOS),(1780-round(35*p),470-round(20*p)))
            layer=Image.new('RGBA',(W,H));text(layer,'Visual Wayback',(220,440),100,'#61758d',True)
            text(layer,'Website history.',(220,680),148,bold=True);text(layer,'Just scroll.',(220,870),148,bold=True)
            # Opening title is already legible at frame zero, then settles by a few pixels.
            frame.alpha_composite(layer,(0,round(12*(1-ease(p*4)))))
            layer=Image.new('RGBA',(W,H));text(layer,'A visual timeline of archived websites.',(230,1230),62,'#6e6e73')
            reveal(frame,layer,t,.18,.38,25)
        elif name=='problem':
            frame=Image.new('RGBA',(W,H),'#17191e')
            layer=Image.new('RGBA',(W,H));layer.alpha_composite(logo,((W-logo.width)//2,320))
            reveal(frame,layer,t,0,.26,18)
            layer=Image.new('RGBA',(W,H));text(layer,'Wayback Machine',(W//2,820),90,'#ffffff',True,'mm')
            text(layer,'Open snapshots. One by one.',(W//2,1100),130,'#ffffff',True,'mm')
            reveal(frame,layer,t,.08,.28,28)
            for j,label in enumerate(['2019','2022','2023']):
                layer=Image.new('RGBA',(W,H));x=900+j*740
                ImageDraw.Draw(layer).rectangle((x,1410,x+580,1600),outline='#767a86',width=3)
                text(layer,label,(x+290,1505),78,'#ffffff',True,'mm')
                if j<2:text(layer,'→',(x+660,1505),66,'#8b92a0',False,'mm')
                reveal(frame,layer,t,.4+j*.65,.3,30)
        elif source_scene:
            f=source_scene['frames'][round(p*119)]
            raw=Image.open(root/f['file']).convert('RGB');assert raw.size==(W,H)
            frame=Image.new('RGBA',(W,H),'#eeeff3')
            # A small focused zoom settles before scrolling; no enlarged source pixels.
            scale=.91+.045*ease(min(p/.25,1));w,h=round(W*scale),round(H*scale)
            x,y=(W-w)//2,(H-h)//2+30
            shadow=Image.new('RGBA',(W,H));ImageDraw.Draw(shadow).rectangle((x+12,y+24,x+w+12,y+h+24),fill=(20,25,38,34))
            frame.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(26)))
            frame.paste(raw.resize((w,h),Image.Resampling.LANCZOS),(x,y))
            label= 'OpenAI  ·  2019 → 2023' if name=='openai' else 'Nvidia  ·  2013 → 2025'
            text(frame,label,(150,20),52,'#58657a',True)
        else:
            frame=Image.new('RGBA',(W,H),'white')
            layer=Image.new('RGBA',(W,H));text(layer,'Try it out now',(W//2,630),90,'#6e6e73',False,'mm')
            text(layer,'visualwayback.com',(W//2,1040),170,'#1d1d1f',True,'mm')
            text(layer,'Free and open source',(W//2,1450),64,'#61758d',False,'mm')
            reveal(frame,layer,t,0,.3,32)
            line=ImageDraw.Draw(frame);length=round(1220*ease(t/.45));line.line((W//2-length//2,1220,W//2+length//2,1220),fill='#61758d',width=6)
        # Short dissolve only across section cuts, never a long blur over readable UI.
        if i<5 and name!='intro':
            previous=Image.open(frames_dir/f'{index-i-1:04d}.jpg').convert('RGBA')
            frame=Image.blend(previous,frame,ease((i+1)/5))
        frame.convert('RGB').save(frames_dir/f'{index:04d}.jpg',quality=97,subsampling=0)
        index+=1

# Give the showcase room to breathe without speeding up the narrator.
# Insert 2.2 seconds in the silent boundary before the final CTA sentence.
alignment=json.loads((root/'voiceover-alignment.json').read_text());a=alignment.get('normalized_alignment')or alignment['alignment']
spoken=''.join(a['characters']);cta=spoken.index('Try it out now');start=a['character_start_times_seconds'][cta]
prior=next(i for i in range(cta-1,-1,-1) if not spoken[i].isspace());end=a['character_end_times_seconds'][prior]
cut=(start+end)/2
audio=root/'voiceover-paced.wav'
filters=f'[0:a]asplit=2[a][b];[a]atrim=end={cut},asetpts=PTS-STARTPTS[a1];[b]atrim=start={cut},asetpts=PTS-STARTPTS[b1];anullsrc=r=44100:cl=mono,atrim=duration=2.2[s];[a1][s][b1]concat=n=3:v=0:a=1[out]'
subprocess.run(['ffmpeg','-v','error','-y','-i',str(root/'voiceover.mp3'),'-filter_complex',filters,'-map','[out]',str(audio)],check=True,timeout=30)
if output.exists() and not (root/'previous-demo.mp4').exists():shutil.copy2(output,root/'previous-demo.mp4')
temporary=output.with_name(output.stem+'.rendering.mp4')
cmd=['ffmpeg','-hide_banner','-y','-framerate','30','-i',str(frames_dir/'%04d.jpg'),'-i',str(audio),'-vf','setsar=1,format=yuv420p','-af','loudnorm=I=-16:TP=-1.5:LRA=11,adelay=80:all=1,apad,atrim=duration=16.4','-frames:v','492','-t','16.4','-c:v','libx264','-preset','fast','-crf','16','-threads','4','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart',str(temporary)]
run=subprocess.run(cmd,capture_output=True,text=True,timeout=600);(root/'render.log').write_text(run.stderr)
if run.returncode:print(run.stderr[-2500:]);raise SystemExit(run.returncode)
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,width,height,nb_frames','-of','json',str(temporary)],text=True))
video=next(s for s in probe['streams'] if s['codec_type']=='video')
assert (video['width'],video['height'],int(video['nb_frames']))==(W,H,492)
assert float(probe['format']['duration'])<17.1
temporary.replace(output)
(root/'edit.json').write_text(json.dumps({'output':str(output),'timeline':timeline,'probe':probe,'nativeResolution':[W,H],'realBrowserScroll':True,'ctaGap':2.2,'ctaCut':cut,'logoSource':capture['logoSource'],'voice':json.loads((root/'voiceover.json').read_text())},indent=2))
print(json.dumps({'output':str(output),'duration':probe['format']['duration'],'resolution':[W,H],'realBrowserScroll':True,'timeline':timeline}))

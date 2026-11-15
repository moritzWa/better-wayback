"""Verify a completed motion export without playing sound on the host."""
import argparse, json, pathlib, subprocess
from PIL import Image, ImageDraw, ImageChops, ImageStat

parser=argparse.ArgumentParser();parser.add_argument('--input',default='/Users/m/Documents/visual-wayback/demo-video/motion')
args=parser.parse_args();root=pathlib.Path(args.input)
edit=json.loads((root/'edit.json').read_text());capture=json.loads((root/'capture.json').read_text());video=edit['output']
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,width,height,nb_frames','-of','json',video],text=True))
stream=next(s for s in probe['streams'] if s['codec_type']=='video')
assert (stream['width'],stream['height'],int(stream['nb_frames']))==(3840,2160,492)
assert abs(float(probe['format']['duration'])-16.4)<.01
assert edit['voice']['voice_id']!='nPczCjzI2devNBz1zQrb' and 'Try it out now' in edit['voice']['text']
assert 'archive.org/' in edit['logoSource'] and (root/'internet-archive-logo.png').exists()
assert capture['noComparisonDialog'] and {s['name'] for s in capture['scenes']}=={'openai','nvidia'}
for scene in capture['scenes']:assert len(set(f['scrollY'] for f in scene['frames']))>=40
times=[0,2.5,4.6,6.4,7.3,8.4,9.5,10.3,11.4,12.4,13.5,16.0]
sheet=Image.new('RGB',(1920,3*294),'#eee');draw=ImageDraw.Draw(sheet);thumbs=[]
for i,t in enumerate(times):
    file=root/f'qa-{i:02d}.png'
    subprocess.run(['ffmpeg','-v','error','-y','-ss',str(t),'-i',video,'-frames:v','1',str(file)],check=True,timeout=30)
    image=Image.open(file).convert('RGB');assert image.size==(3840,2160)
    image.thumbnail((480,270),Image.Resampling.LANCZOS);thumbs.append(image.copy());x=i%4*480;y=i//4*294
    sheet.paste(image,(x,y));draw.text((x+6,y+274),f'{t:.1f}s',fill='black')
differences={}
for name,a,b in [('openai',4,5),('nvidia',7,8)]:
    difference=sum(ImageStat.Stat(ImageChops.difference(thumbs[a],thumbs[b])).mean)/3
    assert difference>5,(name,difference)
    differences[name]=difference
sheet.save(root/'final-contact-sheet.png')
subprocess.run(['ffmpeg','-v','error','-i',video,'-f','null','-'],check=True,timeout=180)
levels=subprocess.run(['ffmpeg','-hide_banner','-i',video,'-vn','-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True,timeout=60)
(root/'final-audio-levels.log').write_text(levels.stderr)
result={'probe':probe,'fullDecode':True,'scrollFrameDifference':differences,'officialArchiveLogo':True,'voice':edit['voice']['voice'],'closingCTA':True,'noComparisonDialog':True}
(root/'qa.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))

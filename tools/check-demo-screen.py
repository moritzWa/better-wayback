"""Check native continuous footage, outer-page scrolling and no compositing of UI frames."""
import json,pathlib,subprocess
from PIL import Image,ImageChops,ImageStat,ImageDraw

root=pathlib.Path('/Users/m/Documents/visual-wayback/demo-video/screen-record')
record=json.loads((root/'recording.json').read_text());edit=json.loads((root/'edit.json').read_text());video=edit['output']
assert record['mode']=='continuous-live-CDP-screencast' and edit['noEditingCameraTransforms']
assert edit['introSite']=='nvidia' and record['scenes'][0]['site']=='nvidia'
assert {s['name'] for s in record['scenes']}=={'intro','openai','apple'}, 'Do not repeat Nvidia after its opening scene.'
for scene in record['scenes']:
    assert len(set(p['outerY'] for p in scene['trace']))>=30
    assert all(p['innerScrolled']==0 for p in scene['trace'])
assert all(f['pixels']==[3840,2160] for f in record['frames'])
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,width,height,nb_frames','-of','json',video],text=True))
stream=next(s for s in probe['streams'] if s['codec_type']=='video')
assert(stream['width'],stream['height'],int(stream['nb_frames']))==(3840,2160,492)
assert abs(float(probe['format']['duration'])-16.4)<.01
# Frame-level identity: final UI is just encoded browser pixels, not a moved/scaled panel.
errors={}
for index in [15,76,238,280,315,370]:
    item=edit['selectedFrames'][index];assert item['kind']=='live-screen'
    file=root/f'identity-{index}.png'
    subprocess.run(['ffmpeg','-v','error','-y','-i',video,'-vf',f'select=eq(n\\,{index})','-fps_mode','vfr','-frames:v','1',str(file)],check=True,timeout=60)
    source=Image.open(item['source']).convert('RGB');decoded=Image.open(file).convert('RGB')
    assert source.size==decoded.size==(3840,2160)
    error=sum(ImageStat.Stat(ImageChops.difference(source,decoded)).mean)/3
    assert error<4,(index,error);errors[index]=error
sheet=Image.new('RGB',(1920,3*294),'#eee');draw=ImageDraw.Draw(sheet)
for i,t in enumerate([0,.9,1.9,3.2,4.8,6.4,7.3,8.6,9.5,10.4,12.1,15.8]):
    file=root/f'qa-{i:02d}.png'
    subprocess.run(['ffmpeg','-v','error','-y','-ss',str(t),'-i',video,'-frames:v','1',str(file)],check=True,timeout=30)
    image=Image.open(file).convert('RGB');image.thumbnail((480,270),Image.Resampling.LANCZOS);x=i%4*480;y=i//4*294
    sheet.paste(image,(x,y));draw.text((x+5,y+274),f'{t:.1f}s',fill='black')
sheet.save(root/'final-contact-sheet.png')
subprocess.run(['ffmpeg','-v','error','-i',video,'-f','null','-'],check=True,timeout=180)
result={'probe':probe,'nativeLiveScreencast':True,'openingNvidiaOuterScroll':True,'innerPreviewScroll':False,'noUITransforms':True,'encodedSourcePixelErrors':errors,'fullDecode':True}
(root/'qa.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))

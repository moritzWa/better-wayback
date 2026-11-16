"""Edit continuous browser footage directly, without sliding, framing or zooming it."""
import argparse,bisect,json,pathlib,shutil,subprocess
from PIL import Image,ImageDraw,ImageFont

parser=argparse.ArgumentParser();parser.add_argument('--input',default='/Users/m/Documents/visual-wayback/demo-video/screen-record');parser.add_argument('--overwrite',action='store_true')
parser.add_argument('--speed',type=float,default=1.25)
args=parser.parse_args();root=pathlib.Path(args.input);graphics=root.parent/'motion';output=pathlib.Path('/Users/m/Desktop/visual-wayback-demo.mp4')
assert 1<=args.speed<=1.5
final_frames=round(492/args.speed);final_duration=final_frames/30
if output.exists() and not args.overwrite:raise SystemExit('Inspect the previous video before replacing it.')
recording=json.loads((root/'recording.json').read_text());assert recording['mode']=='continuous-live-CDP-screencast' and recording['outerPageOnly']
assert recording['viewport']==[3840,2160] and all(f['pixels']==[3840,2160] for f in recording['frames'])
frames=recording['frames'];times=[f['seconds'] for f in frames]
directory=root/'edit-frames';directory.mkdir(exist_ok=True);selected=[];timeline=[];index=0
closing=Image.new('RGB',(3840,2160),'white')
logo=Image.open(pathlib.Path(__file__).resolve().parents[1]/'public/logo.png').convert('RGBA')
logo.thumbnail((1900,420),Image.Resampling.LANCZOS);closing.paste(logo,((3840-logo.width)//2,560),logo)
draw=ImageDraw.Draw(closing)
draw.text((1920,1120),'visualwayback.com',font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf',150),fill='#252528',anchor='mm')
draw.text((1920,1510),'Try it out now · Free and open source',font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',58),fill='#6e6e73',anchor='mm')
closing_path=root/'branded-closing.jpg';closing.save(closing_path,quality=98,subsampling=0)
for name,count in [('intro',108),('problem',102),('openai',105),('apple',105),('cta',72)]:
    timeline.append({'name':name,'start':index/30,'duration':count/30})
    scene=next((s for s in recording['scenes'] if s['name']==name),None)
    for i in range(count):
        if scene:
            # Preserve continuous captured motion and its actual timing. Do not invent scroll frames.
            t=scene['start']+(i/count)*(scene['end']-scene['start'])
            raw=frames[max(0,bisect.bisect_right(times,t)-1)]
            source=root/raw['file'];kind='live-screen'
        else:
            # Retain the approved Archive-logo problem; close on the original product logo.
            source=graphics/'edit-frames'/f'{108+i:04d}.jpg' if name=='problem' else closing_path
            kind='graphic'
        assert Image.open(source).size==(3840,2160)
        destination=directory/f'{index:04d}.jpg'
        if destination.is_symlink():destination.unlink()
        destination.symlink_to(source.resolve());selected.append({'frame':index,'section':name,'kind':kind,'source':str(source)})
        index+=1
assert index==492
# Select exact source frames for the faster output instead of relying on encoder
# variable-frame-rate rounding. This keeps decoded-frame provenance deterministic.
base_selected=selected
selected=[]
for index in range(final_frames):
    source_index=min(491,round(index*args.speed));item=base_selected[source_index]
    destination=directory/f'{index:04d}.jpg';destination.unlink();destination.symlink_to(pathlib.Path(item['source']).resolve())
    selected.append({**item,'frame':index,'baseFrame':source_index})
if output.exists() and not(root/'previous-demo.mp4').exists():shutil.copy2(output,root/'previous-demo.mp4')
temporary=output.with_name(output.stem+'.rendering.mp4')
clean_audio=root.parent/'apple'/'clean-narration.wav'
command=['ffmpeg','-hide_banner','-y','-framerate','30','-i',str(directory/'%04d.jpg'),'-i',str(clean_audio),'-vf','setsar=1,format=yuv420p','-af',f'atempo={args.speed},apad','-frames:v',str(final_frames),'-t',str(final_duration),'-c:v','libx264','-preset','fast','-crf','16','-threads','4','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart',str(temporary)]
run=subprocess.run(command,capture_output=True,text=True,timeout=600);(root/'render.log').write_text(run.stderr)
if run.returncode:print(run.stderr[-2500:]);raise SystemExit(run.returncode)
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,width,height,nb_frames','-of','json',str(temporary)],text=True))
video=next(s for s in probe['streams'] if s['codec_type']=='video')
assert (video['width'],video['height'],int(video['nb_frames']))==(3840,2160,final_frames) and float(probe['format']['duration'])<17.1
temporary.replace(output)
(root/'edit.json').write_text(json.dumps({'output':str(output),'timeline':[{**s,'start':s['start']/args.speed,'duration':s['duration']/args.speed}for s in timeline],'baseTimeline':timeline,'selectedFrames':selected,'speed':args.speed,'pitchPreserved':True,'probe':probe,'nativeResolution':[3840,2160],'noEditingCameraTransforms':True,'outerPageOnly':True,'introSite':'nvidia','sourceMode':recording['mode']},indent=2))
print(json.dumps({'output':str(output),'duration':probe['format']['duration'],'nativePixels':[3840,2160],'continuousScreenRecord':True,'outerPageOnly':True,'introSite':'nvidia'}))

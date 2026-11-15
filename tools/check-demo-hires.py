"""Data-level QA and visual contact sheet for the completed native-4K export."""
import argparse, json, pathlib, subprocess
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('--input', default='/Users/m/Documents/visual-wayback/demo-video/high-res')
args = parser.parse_args(); root = pathlib.Path(args.input)
edit = json.loads((root/'edit.json').read_text()); video = edit['output']
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,codec_type,width,height,nb_frames', '-of', 'json', video], text=True))
stream = next(s for s in probe['streams'] if s['codec_type']=='video')
assert (stream['width'], stream['height'], int(stream['nb_frames'])) == (3840,2160,576)
assert abs(float(probe['format']['duration'])-19.2)<.01
assert next(s for s in probe['streams'] if s['codec_type']=='audio')['codec_name']=='aac'
assert all('compare' not in scene['file'] and 'anthropic' not in scene['file'] for scene in edit['timeline'])
sheet = Image.new('RGB', (1920, 2*294), '#eee'); draw = ImageDraw.Draw(sheet)
for i, scene in enumerate(edit['timeline']):
    position = scene['start'] + scene['duration']/2
    file = root/f'qa-{i:02d}.png'
    subprocess.run(['ffmpeg','-v','error','-y','-ss',str(position),'-i',video,'-frames:v','1',str(file)],check=True,timeout=30)
    image=Image.open(file); assert image.size==(3840,2160)
    image.thumbnail((480,270),Image.Resampling.LANCZOS); x=i%4*480; y=i//4*294
    sheet.paste(image,(x,y)); draw.text((x+6,y+274),f"{position:.1f}s  {scene['file']}",fill='black')
sheet.save(root/'final-contact-sheet.png')
# Decode the whole export, not just selected stills. No playback or sound.
subprocess.run(['ffmpeg','-v','error','-i',video,'-f','null','-'],check=True,timeout=180)
levels=subprocess.run(['ffmpeg','-hide_banner','-i',video,'-vn','-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True,timeout=60)
(root/'final-audio-levels.log').write_text(levels.stderr)
(root/'qa.json').write_text(json.dumps({'probe':probe,'fullDecode':True,'noComparisonScene':True,'noAnthropicScene':True,'contactSheet':str(root/'final-contact-sheet.png')},indent=2))
print(json.dumps({'nativeResolution':[3840,2160],'duration':probe['format']['duration'],'frames':576,'fullDecode':True,'contactSheet':str(root/'final-contact-sheet.png')}))

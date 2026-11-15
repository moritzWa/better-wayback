"""Edit the completed real-UI recording into a strict sub-20-second MP4."""
import argparse, bisect, json, pathlib, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument('--input', default='/Users/m/Documents/visual-wayback/demo-video')
parser.add_argument('--output', default='/Users/m/Desktop/visual-wayback-demo.mp4')
parser.add_argument('--overwrite', action='store_true')
args = parser.parse_args()
root, output = pathlib.Path(args.input), pathlib.Path(args.output)
if output.exists() and not args.overwrite:
    raise SystemExit('Output already exists; inspect it before using --overwrite.')
recording = json.loads((root / 'recording.json').read_text())
assert recording['frames'] and set(s['name'] for s in recording['scenes']) == {'openai', 'anthropic', 'nvidia', 'timeline', 'compare'}
frames = recording['frames']
times = [f['seconds'] for f in frames]
assert times == sorted(times)
size = Image.open(root / frames[0]['file']).size
assert abs(size[0] / size[1] - 16/9) < .02, size
endcard = Image.new('RGB', size, 'white')
draw = ImageDraw.Draw(endcard)
scale = size[0] / 1920
regular = next(p for p in ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc'] if pathlib.Path(p).exists())
bold = next(p for p in ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc'] if pathlib.Path(p).exists())
def label(text, y, px, color, weight=False):
    font = ImageFont.truetype(bold if weight else regular, round(px * scale))
    draw.text((size[0]/2, size[1]*y), text, fill=color, font=font, anchor='mm')
label('Visual Wayback', .37, 86, '#1d1d1f', True)
label('See the web change.', .49, 40, '#6e6e73')
label('visualwayback.com', .62, 52, '#61758d', True)
label('Free and open source', .83, 26, '#6e6e73')
endcard.save(root / 'endcard.jpg', quality=98, subsampling=0)

fps = 30
plan = [('openai', 84), ('anthropic', 75), ('nvidia', 72), ('timeline', 126), ('compare', 120), ('endcard', 111)]
assert sum(count for _, count in plan) == 588
directory = pathlib.Path(tempfile.mkdtemp(prefix='edit-frames-', dir=root))
index = 0
timeline = []
for name, count in plan:
    timeline.append({'scene': name, 'start': index / fps, 'duration': count / fps})
    scene = next((s for s in recording['scenes'] if s['name'] == name), None)
    for frame in range(count):
        if scene:
            t = scene['start'] + (frame / count) * (scene['end'] - scene['start'])
            source = root / frames[max(0, bisect.bisect_right(times, t) - 1)]['file']
        else:
            source = root / 'endcard.jpg'
        (directory / f'{index:06d}.jpg').symlink_to(source.resolve())
        index += 1

output.parent.mkdir(parents=True, exist_ok=True)
temporary = output.with_name(output.stem + '.rendering.mp4')
command = ['ffmpeg', '-hide_banner', '-y', '-framerate', str(fps), '-i', str(directory / '%06d.jpg'), '-i', str(root / 'voiceover.mp3'),
    '-vf', 'scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p',
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,adelay=200:all=1,apad,atrim=duration=19.6',
    '-frames:v', '588', '-t', '19.6', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-threads', '4',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', str(temporary)]
result = subprocess.run(command, capture_output=True, text=True, timeout=300)
(root / 'render.log').write_text(result.stderr)
if result.returncode:
    print(result.stderr[-3000:]); raise SystemExit(result.returncode)
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,codec_type,width,height,avg_frame_rate,nb_frames', '-of', 'json', str(temporary)], text=True))
assert float(probe['format']['duration']) <= 20, probe
video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
assert (video['width'], video['height'], video['codec_name']) == (1920, 1080, 'h264')
assert any(s['codec_type'] == 'audio' and s['codec_name'] == 'aac' for s in probe['streams'])
temporary.replace(output)
(root / 'edit.json').write_text(json.dumps({'output': str(output), 'fps': fps, 'timeline': timeline, 'probe': probe, 'source': recording['base'], 'sourceSize': size, 'editedForBrevity': True}, indent=2))
print(json.dumps({'output': str(output), 'duration': probe['format']['duration'], 'size': probe['format']['size'], 'sourceSize': size, 'scenes': timeline}))

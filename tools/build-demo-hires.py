"""Native 4K pitch / problem / showcase edit. Requires completed DPR-3 PNG captures."""
import argparse, json, pathlib, shutil, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument('--input', default='/Users/m/Documents/visual-wayback/demo-video/high-res')
parser.add_argument('--output', default='/Users/m/Desktop/visual-wayback-demo.mp4')
parser.add_argument('--overwrite', action='store_true')
args = parser.parse_args()
root, output = pathlib.Path(args.input), pathlib.Path(args.output)
if output.exists() and not args.overwrite:
    raise SystemExit('Inspect the previous video before using --overwrite.')
capture = json.loads((root / 'capture.json').read_text())
assert capture['pixels'] == [3840, 2160] and capture['noUpscaling'] and capture['noComparisonDialog']
W, H = 3840, 2160
regular = '/System/Library/Fonts/Supplemental/Arial.ttf'
bold = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
def font(size, weight=False):
    return ImageFont.truetype(bold if weight else regular, size)
def text(draw, value, xy, size, color='#1d1d1f', weight=False):
    draw.text(xy, value, font=font(size, weight), fill=color)
def save_card(name, image):
    image.save(root / f'{name}.png')
    return f'{name}.png'

pitch = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(pitch)
text(d, 'Visual Wayback', (220, 290), 92, '#61758d', True)
text(d, 'Website history,', (220, 540), 146, weight=True)
text(d, 'in one timeline.', (220, 720), 146, weight=True)
text(d, "See how a company's site changed.", (220, 1040), 64, '#6e6e73')
overview = Image.open(root / 'overview.png').convert('RGB'); assert overview.size == (W, H)
# Downsample only, never inflate a low-resolution page or a screencast.
preview = overview.resize((1920, 1080), Image.Resampling.LANCZOS)
pitch.paste(preview, (1840, 490))
d.line((220, 1810, 3620, 1810), fill='#e7e7eb', width=3)
text(d, 'Free and open source', (220, 1870), 52, '#6e6e73')
save_card('pitch', pitch)

problem = Image.new('RGB', (W, H), '#f7f7f8'); d = ImageDraw.Draw(problem)
text(d, 'THE WAYBACK MACHINE WORKFLOW', (300, 260), 58, '#6e6e73')
text(d, 'Open a snapshot.', (300, 540), 156, weight=True)
text(d, 'Go back. Pick another date.', (300, 760), 156, weight=True)
text(d, 'Repeat.', (300, 980), 156, weight=True)
text(d, "It's hard to see what changed over time.", (300, 1550), 84, '#61758d')
save_card('problem', problem)

showcase = []
for site, year, timestamp in [('OpenAI', '2019', '20190107133421'), ('OpenAI', '2023', '20230101012158'), ('Nvidia', '2013', '20130211005742'), ('Nvidia', '2025', '20250101074126')]:
    file = f'{site.lower()}-{timestamp}.png'
    image = Image.open(root / file).convert('RGB'); assert image.size == (W, H)
    d = ImageDraw.Draw(image)
    d.rectangle((0, 1970, W, H), fill='white')
    d.line((0, 1970, W, 1970), fill='#e7e7eb', width=3)
    text(d, f'{site}  /  {year}', (110, 2015), 76, weight=True)
    text(d, 'Visual Wayback', (3070, 2030), 52, '#6e6e73')
    showcase.append(save_card(f'showcase-{site.lower()}-{year}', image))

end = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(end)
for value, y, size, color in [('Visual Wayback', 670, 162, '#1d1d1f'), ('visualwayback.com', 1040, 136, '#61758d'), ('Free and open source', 1510, 64, '#6e6e73')]:
    d.text((W/2, y), value, font=font(size, y < 1500), fill=color, anchor='mm')
save_card('endcard', end)

# Voice alignment: pitch ends 4.24s, problem 8.24s, showcase 14.24s,
# timeline 16.00s, CTA 18.08s. Audio starts 0.20s after picture.
plan = [('pitch.png', 132), ('problem.png', 120), (showcase[0], 45), (showcase[1], 45), (showcase[2], 45), (showcase[3], 45), ('overview.png', 54), ('endcard.png', 90)]
fps = 30; frames = sum(count for _, count in plan); duration = frames / fps
assert frames == 576 and duration == 19.2
directory = pathlib.Path(tempfile.mkdtemp(prefix='native4k-', dir=root))
timeline = []; index = 0
for name, count in plan:
    timeline.append({'file': name, 'start': index/fps, 'duration': count/fps})
    for _ in range(count):
        (directory / f'{index:06d}.png').symlink_to((root / name).resolve()); index += 1

output.parent.mkdir(exist_ok=True, parents=True)
if output.exists():
    previous = root / 'previous-demo.mp4'
    if not previous.exists(): shutil.copy2(output, previous)
temporary = output.with_name(output.stem + '.rendering.mp4')
command = ['ffmpeg', '-hide_banner', '-y', '-framerate', '30', '-i', str(directory/'%06d.png'), '-i', str(root/'voiceover.mp3'),
    '-vf', 'setsar=1,format=yuv420p', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,adelay=200:all=1,apad,atrim=duration=19.2',
    '-frames:v', str(frames), '-t', str(duration), '-c:v', 'libx264', '-preset', 'fast', '-crf', '15', '-threads', '4',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', str(temporary)]
run = subprocess.run(command, capture_output=True, text=True, timeout=480)
(root/'render.log').write_text(run.stderr)
if run.returncode: print(run.stderr[-2500:]); raise SystemExit(run.returncode)
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,codec_type,width,height,nb_frames', '-of', 'json', str(temporary)], text=True))
video = next(s for s in probe['streams'] if s['codec_type']=='video')
assert (video['width'], video['height'], int(video['nb_frames'])) == (W, H, frames)
assert float(probe['format']['duration']) <= 20
temporary.replace(output)
(root/'edit.json').write_text(json.dumps({'output': str(output), 'timeline': timeline, 'probe': probe, 'nativeResolution': [W, H], 'noComparisonDialog': True, 'editedForBrevity': True}, indent=2))
print(json.dumps({'output': str(output), 'duration': probe['format']['duration'], 'nativeResolution': [W,H], 'size': probe['format']['size'], 'timeline': timeline}))

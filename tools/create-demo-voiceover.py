"""Create the short demo narration. The personal API key stays in 1Password/memory."""
import argparse, base64, json, pathlib, subprocess, urllib.request, urllib.error

parser = argparse.ArgumentParser()
parser.add_argument('--item', required=True, help='Personal ElevenLabs 1Password item ID, not the key')
parser.add_argument('--out', required=True)
parser.add_argument('--model', default='eleven_v4')
parser.add_argument('--voice', default='XZgCP7SDPjTJVTavedju')
parser.add_argument('--voice-name', default='Will - Conversational Narrator')
parser.add_argument('--text', help='Override narration text for separately generated complete takes')
parser.add_argument('--basename', default='voiceover')
args = parser.parse_args()
out = pathlib.Path(args.out)
out.mkdir(parents=True, exist_ok=True)
text = args.text or "Visual Wayback. Website history, visualized. On Wayback, open snapshots one by one. Here, just scroll through OpenAI and Apple. Try it out now at visual wayback dot com."
key = subprocess.check_output(['op', 'item', 'get', args.item, '--vault', 'Main', '--fields', 'credential', '--reveal'], text=True).strip()
voice = args.voice  # A licensed library narrator, not a voice clone.
body = {'text': text, 'model_id': args.model, 'voice_settings': {'stability': .5, 'similarity_boost': .75, 'style': .15, 'use_speaker_boost': True, 'speed': 1.05}}
request = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_128', data=json.dumps(body).encode(), headers={'xi-api-key': key, 'Content-Type': 'application/json'}, method='POST')
try:
    with urllib.request.urlopen(request, timeout=120) as response:
        result = json.load(response)
except urllib.error.HTTPError as error:
    data = json.loads(error.read())
    print(json.dumps({'status': error.code, 'error': data.get('detail')}))
    raise SystemExit(1)
(out / f'{args.basename}.mp3').write_bytes(base64.b64decode(result.pop('audio_base64')))
(out / f'{args.basename}-alignment.json').write_text(json.dumps(result, indent=2))
(out / f'{args.basename}.json').write_text(json.dumps({'provider': 'ElevenLabs', 'voice': args.voice_name, 'voice_id': voice, 'model': args.model, 'text': text, 'speed': 1.05}, indent=2))
alignment = result.get('normalized_alignment') or result.get('alignment') or {}
print(json.dumps({'audio': str(out / f'{args.basename}.mp3'), 'characters': len(text), 'lastWordEndsAt': alignment.get('character_end_times_seconds', [None])[-1], 'voice': args.voice_name, 'model': args.model}))

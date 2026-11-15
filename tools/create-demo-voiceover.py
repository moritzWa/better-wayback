"""Create the short demo narration. The personal API key stays in 1Password/memory."""
import argparse, base64, json, pathlib, subprocess, urllib.request, urllib.error

parser = argparse.ArgumentParser()
parser.add_argument('--item', required=True, help='Personal ElevenLabs 1Password item ID, not the key')
parser.add_argument('--out', required=True)
parser.add_argument('--model', default='eleven_v4')
args = parser.parse_args()
out = pathlib.Path(args.out)
out.mkdir(parents=True, exist_ok=True)
text = 'OpenAI before ChatGPT. Anthropic in its earliest days. Nvidia, then and now. Visual Wayback brings archived websites into one timeline. Compare versions, spot changes, and explore the originals. Try it free at visual wayback dot com.'
key = subprocess.check_output(['op', 'item', 'get', args.item, '--vault', 'Main', '--fields', 'credential', '--reveal'], text=True).strip()
voice = 'nPczCjzI2devNBz1zQrb'  # Brian, stock voice, not a clone.
body = {'text': text, 'model_id': args.model, 'voice_settings': {'stability': .5, 'similarity_boost': .75, 'style': .15, 'use_speaker_boost': True, 'speed': 1.05}}
request = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_128', data=json.dumps(body).encode(), headers={'xi-api-key': key, 'Content-Type': 'application/json'}, method='POST')
try:
    with urllib.request.urlopen(request, timeout=120) as response:
        result = json.load(response)
except urllib.error.HTTPError as error:
    data = json.loads(error.read())
    print(json.dumps({'status': error.code, 'error': data.get('detail')}))
    raise SystemExit(1)
(out / 'voiceover.mp3').write_bytes(base64.b64decode(result.pop('audio_base64')))
(out / 'voiceover-alignment.json').write_text(json.dumps(result, indent=2))
(out / 'voiceover.json').write_text(json.dumps({'provider': 'ElevenLabs', 'voice': 'Brian', 'voice_id': voice, 'model': args.model, 'text': text, 'speed': 1.05}, indent=2))
alignment = result.get('normalized_alignment') or result.get('alignment') or {}
print(json.dumps({'audio': str(out / 'voiceover.mp3'), 'characters': len(text), 'lastWordEndsAt': alignment.get('character_end_times_seconds', [None])[-1], 'voice': 'Brian', 'model': args.model}))

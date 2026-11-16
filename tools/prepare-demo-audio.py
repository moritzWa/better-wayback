"""Place complete independent narration takes without cutting a spoken sentence."""
import json,pathlib,subprocess

root=pathlib.Path('/Users/m/Documents/visual-wayback/demo-video/apple')
durations={}
for name in ['voiceover-main','voiceover-cta']:
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','json',str(root/(name+'.mp3'))],text=True))
    durations[name]=float(probe['format']['duration'])
assert durations['voiceover-main']<12 and durations['voiceover-cta']<3.5
# Only eight milliseconds at each file edge are tapered. Never slice an in-stream word
# or concatenate two halves of a model generation around an artificial silence.
main_end=max(0,durations['voiceover-main']-.008)
cta_end=max(0,durations['voiceover-cta']-.008)
filters=f'[0:a]aresample=48000,afade=t=in:d=0.008,afade=t=out:st={main_end}:d=0.008,adelay=80:all=1[a];[1:a]aresample=48000,afade=t=in:d=0.008,afade=t=out:st={cta_end}:d=0.008,adelay=12800:all=1[b];[a][b]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad,atrim=duration=16.4[out]'
subprocess.run(['ffmpeg','-v','error','-y','-i',str(root/'voiceover-main.mp3'),'-i',str(root/'voiceover-cta.mp3'),'-filter_complex',filters,'-map','[out]','-ar','48000','-ac','2',str(root/'clean-narration.wav')],check=True,timeout=60)
(root/'audio-edit.json').write_text(json.dumps({'completeTakes':True,'midSentenceCuts':False,'edgeFadeMs':8,'mainDelayMs':80,'ctaDelayMs':12800,'duration':16.4,'takeDurations':durations},indent=2))
print(json.dumps({'audio':str(root/'clean-narration.wav'),'completeTakes':True,'midSentenceCuts':False,'duration':16.4}))

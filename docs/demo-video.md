# Short product demo

The demo uses the actual Visual Wayback UI and the genuine packaged OpenAI, Anthropic and Nvidia captures. It is edited for brevity, not a real-time speed benchmark. The archive pages themselves are not fabricated. The opening and closing captures for each company show different archived dates.

## Sources and narration

- OpenAI: five captures, 2016–2025.
- Anthropic: four captures, 2021–2025.
- Nvidia: three captures, 2007–2025.
- Narration: ElevenLabs Brian stock voice, Eleven v4, speed 1.05. No voice cloning.
- No background music, so speech stays clear.

The voiceover text is in `tools/create-demo-voiceover.py`. It uses the personal ElevenLabs account, not the Arca forced-alignment key. The restricted personal credential is stored in 1Password Main as **ElevenLabs Visual Wayback voiceover**, expires December 15, 2026 and is capped at 2,000 credits per refresh period. No key is written to source, files or command arguments.

An independent whisper.cpp transcription of the generated narration matched the script, including all three company names and the website address. Loudness is normalized during the final edit. Generating/analysing audio does not play it on the host.

## Recording and edit

`tools/record-demo.js` drives a dedicated muted Linux Space Chromium over forwarded CDP port 19832. Never use an authenticated/shared browser. It warms the actual packaged examples before recording, records CDP screencast frames with timestamps, and logs five scenes: OpenAI, Anthropic, Nvidia, timeline navigation and text comparison. The small cursor overlay is only a recording aid. It changes no product data.

`tools/build-demo.py` samples the completed recording to exactly 588 video frames at 30 fps, adds a simple URL end card and the ElevenLabs narration, and exports a target 19.6-second 1920×1080 H.264/AAC MP4. The voice starts 200 ms into the video. It verifies the muxed duration is no more than 20 seconds before moving the finished file into place. It refuses to overwrite an existing output without `--overwrite`.

Run recording, encoding and audio checks through the shared heavy-job queue. The recording must finish successfully before encoding or copying any frames. Read the first frame and a contact sheet, verify the audio transcript and levels, and check ffprobe duration before opening the MP4 for review.

The default deliverable is `~/Desktop/visual-wayback-demo.mp4`. Source frames, scene timings, voiceover and QA reports live in `~/Documents/visual-wayback/demo-video/`. Keep those paths for revisions rather than opening differently named versions.

## Verified export

The November 15, 2026 export is 19.600 seconds, 588 frames at 30 fps, 1920×1080 H.264 with AAC audio, about 3.1 MB. It was recorded from the deployed public site. The first frame shows the actual OpenAI 2016 capture, not a loading screen. A contact sheet covers all three companies, the comparison dialog and the final URL card. Independent transcription of the final MP4 includes the full narration and uncut closing URL. Measured integrated loudness is -16.9 LUFS and true peak is -4.4 dBTP, with no music masking the voice.

Example commands, after starting the task's muted Linux browser and CDP forward:

```sh
python3 ~/.claude/scripts/heavy-job.py --wait -- node tools/record-demo.js
python3 tools/create-demo-voiceover.py --item <personal-1password-item-id> --out ~/Documents/visual-wayback/demo-video
python3 ~/.claude/scripts/heavy-job.py --wait -- python3 tools/build-demo.py
```

The public site receives the new example presets. The video itself is a local review deliverable; this task does not post it to social media or publish it as a separate website asset.
